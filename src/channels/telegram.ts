/**
 * Telegram Channel
 *
 * Single-user Telegram transport for S3pia.
 * This channel only talks to the configured admin chat.
 */

import {
	conversationStore,
	TELEGRAM_CONVERSATION_ID,
} from "../conversation.js";
import { getEnvVar } from "../env.js";
import { getTaskQueue } from "../task-queue.js";
import { shouldSendQueuedAck } from "../telegram-ack.js";
import { sendTelegramMessageToAdmin } from "../telegram-client.js";
import {
	composeTelegramReceipt,
	type TelegramAttachmentKind,
} from "../telegram-receipt.js";
import { workspacePath } from "../workspace.js";

export interface TelegramChannelConfig {
	enabled: boolean;
	allowFrom: string[];
	token: string;
}

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
	};
}

function sanitizeTelegramFilename(filename: string): string {
	const base = filename
		.split("/")
		.pop()
		?.replace(/[^a-zA-Z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return base || "file";
}

function getValidAdminId(): string | null {
	const value = getEnvVar("ADMIN_TELEGRAM_ID");
	return value && /^[1-9]\d*$/.test(value) ? value : null;
}

function inferAttachmentKind(
	message: TelegramUpdate["message"],
): TelegramAttachmentKind {
	if (!message) return "none";
	if (message.photo?.length) return "photo";
	if (message.document) return "document";
	if (message.video) return "video";
	if (message.audio) return "audio";
	if (message.voice) return "voice";
	return "none";
}

function summarizeTaskPreview(taskInput: string): string {
	const normalized = taskInput.trim().replace(/\s+/g, " ");
	if (normalized.length <= 140) return normalized;
	return `${normalized.slice(0, 137).trimEnd()}...`;
}

export class TelegramChannel {
	private token: string;
	private botIdentity: string;
	private started = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private lastUpdateId = 0;
	private isPolling = false;

	constructor(config: TelegramChannelConfig) {
		this.token = config.token;
		this.botIdentity = config.token.split(":")[0] || "unknown";
	}

	getName(): string {
		return "telegram";
	}

	getStatus(): { name: string; enabled: boolean; running: boolean } {
		return {
			name: this.getName(),
			enabled: true,
			running: this.started,
		};
	}

	isRunning(): boolean {
		return this.started;
	}

	async start(): Promise<void> {
		if (this.started) return;
		if (!this.token) {
			console.warn("[Telegram] No token configured");
			return;
		}

		if (!conversationStore.get(TELEGRAM_CONVERSATION_ID)) {
			conversationStore.create(TELEGRAM_CONVERSATION_ID);
		}

		this.started = true;
		this.pollTimer = setInterval(() => {
			this.pollUpdates().catch((err) => {
				console.error("[Telegram] Poll error:", err);
			});
		}, 11_000);

		await this.pollUpdates();
		console.log("[Telegram] Bot started");
	}

	async stop(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.started = false;
		console.log("[Telegram] Bot stopped");
	}

	async restart(): Promise<void> {
		await this.stop();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await this.start();
	}

	async send(message: {
		recipientId: string;
		content: string;
		metadata?: Record<string, unknown>;
	}): Promise<void> {
		const adminId = getValidAdminId();
		if (!adminId || message.recipientId !== adminId) {
			console.warn("[Telegram] Refusing to send to non-admin recipient");
			return;
		}

		await sendTelegramMessageToAdmin(message.content);
	}

	async broadcast(content: string): Promise<void> {
		await this.sendMessageToAdmin(content);
	}

	private async sendMessageToAdmin(
		text: string,
		files: string[] = [],
	): Promise<void> {
		await sendTelegramMessageToAdmin(text, files);
	}

	private async pollUpdates(): Promise<void> {
		if (this.isPolling) return;
		this.isPolling = true;

		try {
			const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;
			const response = await fetch(url);
			const data = (await response.json()) as {
				ok: boolean;
				description?: string;
				result?: TelegramUpdate[];
			};

			if (!data.ok) {
				console.error("[Telegram] API error:", data.description);
				return;
			}

			const updates = data.result || [];
			for (const update of updates) {
				await this.processUpdate(update);
				this.lastUpdateId = update.update_id;
			}
		} catch (err) {
			console.error("[Telegram] Poll error:", err);
		} finally {
			this.isPolling = false;
		}
	}

	private async processUpdate(update: TelegramUpdate): Promise<void> {
		const message = update.message;
		if (!message) return;

		const senderId = message.from?.id?.toString() || message.chat.id.toString();
		const adminId = getValidAdminId();
		if (!adminId || senderId !== adminId) {
			console.warn(`[Telegram] Rejected unauthorized sender ${senderId}`);
			return;
		}

		const parts: string[] = [];
		const text = message.text || message.caption || "";
		if (text) {
			parts.push(text);
		}

		const timestamp = Date.now();
		if (message.photo?.length) {
			const lastPhoto = message.photo[message.photo.length - 1];
			if (lastPhoto) {
				const savePath = await this.downloadFile(
					lastPhoto.file_id,
					`photo_${timestamp}.jpg`,
				);
				parts.push(`[FILE: ${savePath}]`);
			}
		} else if (message.document) {
			const savePath = await this.downloadFile(
				message.document.file_id,
				message.document.file_name || `file_${timestamp}`,
			);
			parts.push(`[FILE: ${savePath}]`);
		} else if (message.video) {
			const savePath = await this.downloadFile(
				message.video.file_id,
				message.video.file_name || `video_${timestamp}.mp4`,
			);
			parts.push(`[FILE: ${savePath}]`);
		} else if (message.audio) {
			const savePath = await this.downloadFile(
				message.audio.file_id,
				message.audio.file_name || `audio_${timestamp}.mp3`,
			);
			parts.push(`[FILE: ${savePath}]`);
		} else if (message.voice) {
			const savePath = await this.downloadFile(
				message.voice.file_id,
				`voice_${timestamp}.ogg`,
			);
			parts.push(`[FILE: ${savePath}]`);
		}

		const content = parts.join("\n").trim();
		if (message.text?.startsWith("/")) {
			await this.handleCommand(message.chat.id, message.text);
			return;
		}

		const existingTask = getTaskQueue().getBySourceKey(
			`telegram:${this.botIdentity}:${update.update_id}`,
		);
		if (existingTask) return;

		const queue = getTaskQueue();
		const blockedTask = queue.getLatestBlocked();
		const backlogCount = queue.getBacklogCount();
		const shouldAck =
			Boolean(blockedTask) ||
			shouldSendQueuedAck({
				content,
				hasFileAttachment: content.includes("[FILE:"),
				backlogCount,
			});
		const attachmentKind = inferAttachmentKind(message);

		const conversation =
			conversationStore.get(TELEGRAM_CONVERSATION_ID) ||
			conversationStore.create(TELEGRAM_CONVERSATION_ID);
		const history = [...conversation.messages];
		const preferredLanguage =
			conversationStore.getMetadata(TELEGRAM_CONVERSATION_ID)
				.preferredLanguage || null;
		conversationStore.addMessage(
			TELEGRAM_CONVERSATION_ID,
			"user",
			content,
			"telegram",
		);
		const liveHistory = conversationStore.getMessagesForAI(
			TELEGRAM_CONVERSATION_ID,
		);
		const followUpTimestamp =
			conversation.messages.at(-1)?.timestamp ?? Date.now();

		if (blockedTask) {
			conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
				activeTaskId: blockedTask.id,
				activeTaskSourceKey: blockedTask.sourceKey,
				activeTaskStatus: blockedTask.status,
				activeTaskPreview: summarizeTaskPreview(
					blockedTask.input || blockedTask.result || "",
				),
				activeTaskQuestion: blockedTask.question,
				activeTaskStartedAt: blockedTask.createdAt,
				activeTaskUpdatedAt: followUpTimestamp,
			});
		}

		if (shouldAck) {
			const receiptTaskContext =
				blockedTask && blockedTask.status === "blocked"
					? {
							status: blockedTask.status,
							preview: summarizeTaskPreview(
								blockedTask.input || blockedTask.result || "",
							),
							question: blockedTask.question,
						}
					: null;
			const receipt = await composeTelegramReceipt({
				content,
				hasFileAttachment: content.includes("[FILE:"),
				backlogCount,
				attachmentKind,
				preferredLanguage,
				activeTask: receiptTaskContext,
			});
			conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
				preferredLanguage: receipt.intake.language,
				lastIntakeKind: receipt.intake.messageKind,
				lastIntakeNextStep: receipt.intake.nextStep,
				lastIntakeGoal: receipt.intake.understoodGoal,
			});
			console.log(
				`[Telegram] Early receipt sent (${receipt.usedFallback ? "fallback" : "contextual"}): ${receipt.intake.messageKind}`,
			);
			await this.sendRawMessage(message.chat.id, receipt.text);

			if (
				blockedTask &&
				(receipt.intake.messageKind === "task_update" ||
					receipt.intake.messageKind === "blocked_answer")
			) {
				const resumed = queue.resumeBlockedTask(
					blockedTask.id,
					receipt.taskInput || content,
					liveHistory,
					followUpTimestamp,
				);
				if (!resumed) {
					queue.enqueue({
						kind: "telegram",
						sourceKey: `telegram:${this.botIdentity}:${update.update_id}`,
						input: receipt.taskInput || content,
						history,
					});
				}
				return;
			}

			if (receipt.shouldEnqueue && receipt.taskInput) {
				queue.enqueue({
					kind: "telegram",
					sourceKey: `telegram:${this.botIdentity}:${update.update_id}`,
					input: receipt.taskInput,
					history,
				});
			}
			return;
		}

		queue.enqueue({
			kind: "telegram",
			sourceKey: `telegram:${this.botIdentity}:${update.update_id}`,
			input: content,
			history,
		});
	}

	private async handleCommand(chatId: number, text: string): Promise<void> {
		const command = text.trim().split(/\s+/)[0]?.toLowerCase() || "";

		if (command === "/start") {
			await this.sendRawMessage(
				chatId,
				"Welcome to S3pia. Send a message and I will handle it here.",
			);
			return;
		}

		if (command === "/help") {
			await this.sendRawMessage(
				chatId,
				"Available commands: /start, /help, /status",
			);
			return;
		}

		if (command === "/status") {
			const latest = getTaskQueue().getLatest();
			await this.sendRawMessage(
				chatId,
				latest
					? `Latest task: ${latest.status}${latest.error ? ` (${latest.error})` : ""}`
					: "No tasks have been queued.",
			);
			return;
		}

		await this.sendRawMessage(chatId, "Unknown command. Use /help.");
	}

	private async sendRawMessage(
		_chatId: number,
		text: string,
	): Promise<boolean> {
		try {
			const result = await sendTelegramMessageToAdmin(text);
			return result.ok;
		} catch (err) {
			console.error("[Telegram] Error sending message:", err);
			return false;
		}
	}

	private async downloadFile(
		fileId: string,
		filename: string,
	): Promise<string> {
		const fileInfoUrl = `https://api.telegram.org/bot${this.token}/getFile?file_id=${fileId}`;
		const fileInfo = (await fetch(fileInfoUrl).then((r) => r.json())) as {
			ok: boolean;
			description?: string;
			result?: { file_path: string };
		};

		if (!fileInfo.ok || !fileInfo.result?.file_path) {
			throw new Error(
				`Failed to get file info: ${fileInfo.description || "unknown error"}`,
			);
		}

		const fileUrl = `https://api.telegram.org/file/bot${this.token}/${fileInfo.result.file_path}`;
		const response = await fetch(fileUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to download Telegram file: HTTP ${response.status}`,
			);
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > 20 * 1024 * 1024) {
			throw new Error("Telegram file exceeds the 20 MB workspace upload limit");
		}

		const safeName = sanitizeTelegramFilename(filename);
		const savePath = workspacePath("files", `${Date.now()}_${safeName}`);
		await Bun.$`mkdir -p ${workspacePath("files")}`;
		await Bun.write(savePath, Buffer.from(buffer));

		return savePath;
	}
}

export function createTelegramChannel(): TelegramChannel | null {
	const token = getEnvVar("TELEGRAM_BOT_TOKEN");
	if (!token) {
		console.log("[Telegram] No token configured, skipping");
		return null;
	}

	const telegramEnabled = getEnvVar("TELEGRAM_ENABLED");
	if (telegramEnabled === "false" || telegramEnabled === "0") {
		console.log("[Telegram] Telegram is disabled in settings, skipping");
		return null;
	}

	const adminTelegramId = getValidAdminId();
	if (!adminTelegramId) {
		console.warn(
			"[Telegram] ADMIN_TELEGRAM_ID is missing or invalid; Telegram is disabled",
		);
		return null;
	}

	return new TelegramChannel({
		enabled: true,
		allowFrom: [adminTelegramId],
		token,
	});
}
