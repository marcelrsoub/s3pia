/**
 * Telegram Channel
 *
 * Telegram bot implementation extending BaseChannel.
 * Handles message polling, command processing, and file downloads.
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import { Agent } from "../agent.js";
import { conversationStore } from "../conversation.js";
import { getEnvVar } from "../env.js";
import {
	BaseChannel,
	type ChannelConfig,
	type InboundMessage,
	type OutboundMessage,
} from "./base.js";

/**
 * Telegram channel configuration
 */
export interface TelegramChannelConfig extends ChannelConfig {
	token: string;
}

/**
 * Telegram update from webhook/polling
 */
interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		chat: { id: number; type: string };
		from?: { id: number; first_name?: string; username?: string };
		text?: string;
		caption?: string;
		photo?: Array<{ file_id: string }>;
		document?: { file_id: string; file_name?: string };
		video?: { file_id: string; file_name?: string };
		audio?: { file_id: string; file_name?: string };
		voice?: { file_id: string };
		sticker?: { file_id: string };
		animation?: { file_id: string; file_name?: string };
	};
}

/**
 * Convert Markdown to Telegram MarkdownV2 format
 *
 * Telegram MarkdownV2 requires escaping special chars, but we want to
 * preserve valid formatting. Strategy:
 * 1. Identify and protect valid Markdown patterns with placeholders
 * 2. Escape remaining special characters
 * 3. Restore placeholders in valid MarkdownV2 format
 */
function convertToTelegramMarkdown(text: string): string {
	const SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!]/;
	const ALL_SPECIAL = /[_*[\]()~`>#+\-=|{}.!]/g;

	interface ProtectedPart {
		placeholder: string;
		replacement: string;
	}
	const protectedParts: ProtectedPart[] = [];
	let placeholderIndex = 0;

	const protect = (replacement: string): string => {
		const placeholder = `\x00PH${placeholderIndex++}\x00`;
		protectedParts.push({ placeholder, replacement });
		return placeholder;
	};

	let result = text;

	// Protect code blocks first (``` ... ```)
	result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const escapedCode = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
		return protect(`\`\`\`${lang}\n${escapedCode}\`\`\``);
	});

	// Protect inline code (` ... `)
	result = result.replace(/`([^`\n]+)`/g, (_, code) => {
		const escaped = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
		return protect(`\`${escaped}\``);
	});

	// Protect links [text](url)
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
		const escapedText = linkText.replace(ALL_SPECIAL, "\\$&");
		const escapedUrl = url.replace(/[)]/g, "\\$&");
		return protect(`[${escapedText}](${escapedUrl})`);
	});

	// Protect bold (**text** or __text__)
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`*${escaped}*`);
	});
	result = result.replace(/__([^_]+)__/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`__${escaped}__`);
	});

	// Protect italic (*text* or _text_) - must come after bold
	result = result.replace(/\*([^*\n]+)\*/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`_${escaped}_`);
	});
	result = result.replace(/_([^_\n]+)_/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`_${escaped}_`);
	});

	// Protect blockquotes (> text at line start)
	result = result.replace(/^(>+\s*)(.*)$/gm, (_, prefix, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`${prefix}${escaped}`);
	});

	// Escape all remaining special characters
	result = result.replace(ALL_SPECIAL, "\\$&");

	// Restore protected parts
	for (const { placeholder, replacement } of protectedParts) {
		result = result.replace(placeholder, replacement);
	}

	return result;
}

/**
 * Telegram Bot Channel
 */
export class TelegramChannel extends BaseChannel {
	private token: string;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private lastUpdateId = 0;
	private isPolling = false; // Prevent concurrent polls
	private readonly PORT = process.env.PORT || "3000";

	constructor(config: TelegramChannelConfig) {
		super(config);
		this.token = config.token;
	}

	/**
	 * Get channel name
	 */
	getName(): string {
		return "telegram";
	}

	/**
	 * Start Telegram bot (begin polling)
	 */
	async start(): Promise<void> {
		if (this.started) {
			console.log("[Telegram] Already started");
			return;
		}

		if (!this.token) {
			console.warn("[Telegram] No token configured");
			return;
		}

		console.log("[Telegram] Starting bot...");

		// Ensure telegram conversation exists
		if (!conversationStore.get("telegram")) {
			conversationStore.create("telegram");
		}

		// Register callback for sending messages
		conversationStore.registerTelegramCallback(async (content: string) => {
			await this.broadcastToAuthorized(content);
		});

		// Start polling
		this.startPolling();
		this.started = true;
		console.log("[Telegram] Bot started");
	}

	/**
	 * Stop Telegram bot
	 */
	async stop(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.started = false;
		console.log("[Telegram] Bot stopped");
	}

	/**
	 * Send message to a user
	 */
	async send(message: OutboundMessage): Promise<void> {
		const chatId = Number.parseInt(message.recipientId, 10);
		if (Number.isNaN(chatId)) {
			console.error("[Telegram] Invalid chat ID:", message.recipientId);
			return;
		}

		await this.sendMessageToChat(chatId, message.content);
	}

	/**
	 * Start polling for updates
	 */
	private startPolling(): void {
		this.pollTimer = setInterval(() => {
			this.pollUpdates().catch((err) => {
				console.error("[Telegram] Poll error:", err);
			});
		}, 11000); // Poll every 11 seconds
	}

	/**
	 * Poll for updates from Telegram
	 */
	private async pollUpdates(): Promise<void> {
		// Prevent concurrent polling - skip if already in progress
		if (this.isPolling) {
			console.log("[Telegram] Poll already in progress, skipping");
			return;
		}

		this.isPolling = true;
		try {
			const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;
			const response = await fetch(url);
			const data = await response.json();

			if (!data.ok) {
				console.error("[Telegram] API error:", data.description);
				return;
			}

			const updates: TelegramUpdate[] = data.result || [];
			for (const update of updates) {
				// Update offset BEFORE processing to prevent re-processing
				this.lastUpdateId = update.update_id;
				await this.processUpdate(update);
			}
		} catch (err) {
			console.error("[Telegram] Poll error:", err);
		} finally {
			this.isPolling = false;
		}
	}

	/**
	 * Process a single update
	 */
	private async processUpdate(update: TelegramUpdate): Promise<void> {
		if (!update.message) return;

		const { chat, from, text, caption } = update.message;
		const messageText = text || caption || "";
		console.log(
			`[Telegram] [${from?.first_name || "Unknown"}] ${messageText || "[media]"}`,
		);

		// Check authorization
		const senderId = from?.id?.toString() || chat.id.toString();
		if (!this.isAllowed(senderId)) {
			await this.sendRawMessage(
				chat.id,
				"🔒 You are not authorized to use this bot.",
			);
			return;
		}

		// Handle commands
		if (text && text.startsWith("/")) {
			await this.handleCommand(chat.id, senderId, text);
			return;
		}

		// Handle regular message with files
		let content = messageText;
		const timestamp = Date.now();

		// Handle file attachments
		if (update.message.photo?.length) {
			const lastPhoto = update.message.photo[update.message.photo.length - 1];
			if (lastPhoto) {
				const path = await this.downloadFile(
					lastPhoto.file_id,
					`photo_${timestamp}.jpg`,
				);
				content += `\n[FILE: ${path}]`;
			}
		} else if (update.message.document) {
			const path = await this.downloadFile(
				update.message.document.file_id,
				update.message.document.file_name || `file_${timestamp}`,
			);
			content += `\n[FILE: ${path}]`;
		} else if (update.message.video) {
			const path = await this.downloadFile(
				update.message.video.file_id,
				update.message.video.file_name || `video_${timestamp}.mp4`,
			);
			content += `\n[FILE: ${path}]`;
		} else if (update.message.audio) {
			const path = await this.downloadFile(
				update.message.audio.file_id,
				update.message.audio.file_name || `audio_${timestamp}.mp3`,
			);
			content += `\n[FILE: ${path}]`;
		} else if (update.message.voice) {
			const path = await this.downloadFile(
				update.message.voice.file_id,
				`voice_${timestamp}.ogg`,
			);
			content += `\n[FILE: ${path}]`;
		}

		// Forward to agent via HTTP endpoint
		// Show typing indicator while processing
		await this.sendTypingAction(chat.id);

		try {
			const response = await fetch(`http://localhost:${this.PORT}/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: content, source: "telegram" }),
			});

			if (!response.ok) {
				await this.sendRawMessage(
					chat.id,
					"⚠️ Failed to process your message\\. Please try again\\.",
				);
			}
		} catch (err) {
			console.error("[Telegram] Error forwarding to agent:", err);
			await this.sendRawMessage(
				chat.id,
				"⚠️ Something went wrong\\. Please try again later\\.",
			);
		}
	}

	/**
	 * Handle bot commands
	 */
	private async handleCommand(
		chatId: number,
		senderId: string,
		text: string,
	): Promise<void> {
		const parts = text.trim().split(/\s+/);
		const command = parts[0]?.toLowerCase() ?? "";

		if (command === "/start") {
			await this.sendRawMessage(
				chatId,
				"🤎 Welcome to SepiaBot!\n\nSend me a message and I'll help you out.",
			);
			return;
		}

		if (command === "/help") {
			await this.sendRawMessage(
				chatId,
				"*Available Commands:*\n/start - Welcome message\n/help - Show this message",
			);
			return;
		}

		await this.sendRawMessage(
			chatId,
			"Unknown command. Use /help for available commands.",
		);
	}

	/**
	 * Send text message to chat
	 */
	private async sendMessageToChat(
		chatId: number,
		text: string,
	): Promise<boolean> {
		try {
			const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text: convertToTelegramMarkdown(text),
					parse_mode: "MarkdownV2",
				}),
			});

			const data = await response.json();
			return data.ok;
		} catch (err) {
			console.error("[Telegram] Error sending message:", err);
			return false;
		}
	}

	/**
	 * Send raw message without escaping
	 */
	private async sendRawMessage(chatId: number, text: string): Promise<boolean> {
		try {
			const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text,
					parse_mode: "MarkdownV2",
				}),
			});

			const data = await response.json();
			if (!data.ok) {
				console.error("[Telegram] API error:", data.description);
			}
			return data.ok;
		} catch (err) {
			console.error("[Telegram] Error sending message:", err);
			return false;
		}
	}

	/**
	 * Send typing action to show "typing..." indicator
	 */
	private async sendTypingAction(chatId: number): Promise<void> {
		try {
			const url = `https://api.telegram.org/bot${this.token}/sendChatAction`;
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					action: "typing",
				}),
			});
			const data = (await response.json()) as {
				ok: boolean;
				description?: string;
			};
			if (!data.ok) {
				console.error("[Telegram] Typing action failed:", data.description);
			}
		} catch (err) {
			console.error("[Telegram] Error sending typing action:", err);
		}
	}

	/**
	 * Download file from Telegram
	 */
	private async downloadFile(
		fileId: string,
		filename: string,
	): Promise<string> {
		const fileInfoUrl = `https://api.telegram.org/bot${this.token}/getFile?file_id=${fileId}`;
		const fileInfo = await fetch(fileInfoUrl).then((r) => r.json());

		if (!fileInfo.ok) {
			throw new Error(`Failed to get file info: ${fileInfo.description}`);
		}

		const fileUrl = `https://api.telegram.org/file/bot${this.token}/${fileInfo.result.file_path}`;
		const response = await fetch(fileUrl);
		const buffer = await response.arrayBuffer();

		const fs = await import("node:fs");
		const savePath = `/app/ws/files/${filename}`;
		await fs.promises.mkdir("/app/ws/files", { recursive: true });
		await fs.promises.writeFile(savePath, Buffer.from(buffer));

		return savePath;
	}

	/**
	 * Broadcast message to all authorized users
	 */
	private async broadcastToAuthorized(content: string): Promise<void> {
		const allowedUsers = this.config.allowFrom;

		const lines = content.split("\n");
		const files: string[] = [];
		const textLines: string[] = [];

		for (const line of lines) {
			const fileMatch = line.match(/\[FILE: (\/app\/ws\/[^\]]+)\]/);
			if (fileMatch && fileMatch[1]) {
				files.push(fileMatch[1]);
			} else {
				textLines.push(line);
			}
		}

		const fullText = textLines.join("\n");

		for (const userId of allowedUsers) {
			const chatId = Number.parseInt(userId, 10);
			if (Number.isNaN(chatId)) continue;

			if (fullText.trim()) {
				const CHUNK_SIZE = 4000;
				for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
					const chunk = fullText.slice(i, i + CHUNK_SIZE);
					await this.sendMessageToChat(chatId, chunk);
				}
			}

			for (const file of files) {
				await this.sendFile(chatId, file);
			}
		}
	}

	/**
	 * Send file to chat
	 */
	private async sendFile(chatId: number, path: string): Promise<boolean> {
		const fs = await import("node:fs");
		const ext = path.split(".").pop()?.toLowerCase() || "";

		try {
			const formData = new FormData();
			formData.append("chat_id", chatId.toString());

			let url = "";
			let fieldName = "";
			if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
				url = `https://api.telegram.org/bot${this.token}/sendPhoto`;
				fieldName = "photo";
			} else if (["mp4", "mov", "webm"].includes(ext)) {
				url = `https://api.telegram.org/bot${this.token}/sendVideo`;
				fieldName = "video";
			} else {
				url = `https://api.telegram.org/bot${this.token}/sendDocument`;
				fieldName = "document";
			}

			formData.append(
				fieldName,
				new Blob([fs.readFileSync(path)]),
				path.split("/").pop()!,
			);

			const response = await fetch(url, { method: "POST", body: formData });
			const data = await response.json();
			if (!data.ok) {
				console.error(`[Telegram] sendFile failed:`, data.description);
			}
			return data.ok;
		} catch (err) {
			console.error("[Telegram] Error sending file:", err);
			return false;
		}
	}

	/**
	 * Restart the bot (for token changes)
	 */
	async restart(): Promise<void> {
		await this.stop();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await this.start();
	}

	/**
	 * Broadcast message to all authorized users (public interface for tools)
	 */
	async broadcast(content: string): Promise<void> {
		await this.broadcastToAuthorized(content);
	}
}

/**
 * Create Telegram channel from settings
 */
export function createTelegramChannel(): TelegramChannel | null {
	const token = getEnvVar("TELEGRAM_BOT_TOKEN");
	if (!token) {
		console.log("[Telegram] No token configured, skipping");
		return null;
	}

	// Check if Telegram is explicitly disabled
	const telegramEnabled = getEnvVar("TELEGRAM_ENABLED");
	if (telegramEnabled === "false" || telegramEnabled === "0") {
		console.log("[Telegram] Telegram is disabled in settings, skipping");
		return null;
	}

	const allowFromStr = getEnvVar("ADMIN_TELEGRAM_ID") || "";
	const allowFrom = allowFromStr ? [allowFromStr] : [];

	return new TelegramChannel({
		enabled: true,
		allowFrom,
		token,
	});
}
