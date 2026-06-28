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
import {
	formatLiveRunAge,
	getLiveRunCoordinator,
	type LiveRunTriggerKind,
} from "../live-run.js";
import { shouldSendLiveAck } from "../telegram-ack.js";
import { sendTelegramMessageToAdmin } from "../telegram-client.js";
import {
	classifyTelegramReceiptIntake,
	composeTelegramReceipt,
	type TelegramAttachmentKind,
	type TelegramReceiptContext,
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

function summarizeLiveRunPreview(text: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (normalized.length <= 140) return normalized;
	return `${normalized.slice(0, 137).trimEnd()}...`;
}

function buildStatusMessage() {
	const snapshot = getLiveRunCoordinator().getStatusSnapshot(
		TELEGRAM_CONVERSATION_ID,
	);
	const currentRun = snapshot.currentRun;

	if (currentRun?.status === "running") {
		return [
			"Live run: running",
			currentRun.source ? `Source: ${currentRun.source}` : null,
			`Preview: ${summarizeLiveRunPreview(currentRun.preview)}`,
			currentRun.startedAt
				? `Running for: ${formatLiveRunAge(currentRun.startedAt)}`
				: null,
			snapshot.rerunRequested ? "A new update is waiting." : null,
			"Send /cancel to stop the current run.",
		]
			.filter(Boolean)
			.join("\n");
	}

	if (currentRun?.status === "blocked") {
		return [
			"Live run: blocked",
			currentRun.source ? `Source: ${currentRun.source}` : null,
			`Preview: ${summarizeLiveRunPreview(currentRun.preview)}`,
			currentRun.question ? `Question: ${currentRun.question}` : null,
			currentRun.startedAt
				? `Waiting for: ${formatLiveRunAge(currentRun.startedAt)}`
				: null,
			"Reply with the answer to continue this run.",
		]
			.filter(Boolean)
			.join("\n");
	}

	return ["Live run: idle", "Send a message and I’ll start one here."].join(
		"\n",
	);
}

function mapReceiptKindToTriggerKind(
	messageKind: string,
	liveStatus: "idle" | "running" | "blocked",
): LiveRunTriggerKind {
	if (messageKind === "blocked_answer") {
		return "blocked_answer";
	}

	return liveStatus === "idle" ? "new_run" : "live_update";
}

export class TelegramChannel {
	private token: string;
	private started = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private lastUpdateId = 0;
	private isPolling = false;
	private pollAbortController: AbortController | null = null;
	private activePoll: Promise<void> | null = null;

	constructor(config: TelegramChannelConfig) {
		this.token = config.token;
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
		this.lastUpdateId =
			conversationStore.getMetadata(TELEGRAM_CONVERSATION_ID)
				.telegramLastProcessedUpdateId || 0;

		this.started = true;
		this.pollTimer = setInterval(() => {
			this.pollUpdates().catch((err) => {
				console.error("[Telegram] Poll error:", err);
			});
		}, 11_000);

		await this.pollUpdates();
		if (this.started) {
			console.log("[Telegram] Bot started");
		}
	}

	async stop(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.started = false;
		this.pollAbortController?.abort(
			new Error("Telegram polling stopped"),
		);
		if (this.activePoll) {
			await this.activePoll.catch(() => undefined);
		}
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
		if (this.isPolling || !this.started) return;
		this.isPolling = true;
		const controller = new AbortController();
		this.pollAbortController = controller;
		const poll = (async () => {
			try {
				const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;
				const response = await fetch(url, {
					signal: controller.signal,
				});
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
					conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
						telegramLastProcessedUpdateId: this.lastUpdateId,
					});
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					console.error("[Telegram] Poll error:", err);
				}
			} finally {
				if (this.pollAbortController === controller) {
					this.pollAbortController = null;
				}
				this.isPolling = false;
			}
		})();
		this.activePoll = poll;

		try {
			await poll;
		} finally {
			if (this.activePoll === poll) {
				this.activePoll = null;
			}
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

		const coordinator = getLiveRunCoordinator();
		const liveSnapshot = coordinator.getStatusSnapshot(
			TELEGRAM_CONVERSATION_ID,
		);
		const currentRun = liveSnapshot.currentRun;
		const hasFileAttachment = content.includes("[FILE:");
		const attachmentKind = inferAttachmentKind(message);
		const preferredLanguage =
			conversationStore.getMetadata(TELEGRAM_CONVERSATION_ID)
				.preferredLanguage || null;
		const shouldAck = shouldSendLiveAck({
			content,
			hasFileAttachment,
			isBusy: liveSnapshot.status !== "idle",
		});

		conversationStore.addMessage(
			TELEGRAM_CONVERSATION_ID,
			"user",
			content,
			"telegram",
		);

		const receiptContext: TelegramReceiptContext = {
			content,
			hasFileAttachment,
			isBusy: liveSnapshot.status !== "idle",
			attachmentKind,
			preferredLanguage,
			activeRun:
				currentRun && currentRun.status !== "idle"
					? {
							status: currentRun.status,
							preview: currentRun.preview,
							question: currentRun.question,
						}
					: null,
		};

		const fallbackIntake = classifyTelegramReceiptIntake(receiptContext);
		const receipt = shouldAck
			? await composeTelegramReceipt(receiptContext)
			: {
					text: fallbackIntake.reply,
					intake: fallbackIntake,
					usedFallback: true,
				};

		conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
			preferredLanguage: receipt.intake.language,
			lastIntakeKind: receipt.intake.messageKind,
			lastIntakeNextStep: receipt.intake.nextStep,
			lastIntakeGoal: receipt.intake.understoodGoal,
		});

		const shouldSendReceipt = shouldAck;
		if (shouldSendReceipt) {
			console.log(
				`[Telegram] Live receipt sent (${receipt.usedFallback ? "fallback" : "contextual"}): ${receipt.intake.messageKind}`,
			);
			await this.sendRawMessage(message.chat.id, receipt.text);
		}

		coordinator.requestRun({
			conversationId: TELEGRAM_CONVERSATION_ID,
			source: "telegram",
			kind: mapReceiptKindToTriggerKind(
				receipt.intake.messageKind,
				liveSnapshot.status,
			),
			preview: summarizeLiveRunPreview(content),
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
				"Available commands: /start, /help, /steer, /cancel, /stop",
			);
			return;
		}

		if (command === "/status") {
			await this.sendRawMessage(chatId, buildStatusMessage());
			return;
		}

		if (command === "/steer") {
			const steerText = text.slice(command.length).trim();
			if (!steerText) {
				await this.sendRawMessage(
					chatId,
					"Use /steer followed by a short instruction for the current live run.",
				);
				return;
			}

			conversationStore.addMessage(
				TELEGRAM_CONVERSATION_ID,
				"user",
				steerText,
				"telegram",
			);

			getLiveRunCoordinator().requestRun({
				conversationId: TELEGRAM_CONVERSATION_ID,
				source: "manual",
				kind: "steer",
				preview: summarizeLiveRunPreview(steerText),
			});

			await this.sendRawMessage(
				chatId,
				`Steering the current live run: ${summarizeLiveRunPreview(steerText)}`,
			);
			return;
		}

		if (command === "/cancel" || command === "/stop") {
			const cancelled = getLiveRunCoordinator().cancelActiveRun(
				TELEGRAM_CONVERSATION_ID,
			);
			await this.sendRawMessage(
				chatId,
				cancelled
					? `Cancelled the current run: ${summarizeLiveRunPreview(cancelled.preview)}`
					: "No live run is active. Send a message to start one.",
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
