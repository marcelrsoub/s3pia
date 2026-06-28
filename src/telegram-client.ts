import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { createLinkedAbortController } from "./abort.js";
import { getEnvVar } from "./env.js";
import { workspacePath } from "./workspace.js";

export interface TelegramFileAttachment {
	filename: string;
	path: string;
	size?: number;
	downloadUrl: string;
}

export interface SendTelegramResult {
	ok: boolean;
	messageDelivered: boolean;
	attachments: TelegramFileAttachment[];
	warnings: string[];
}

const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

function getTelegramBotToken(): string | null {
	return getEnvVar("TELEGRAM_BOT_TOKEN") || null;
}

function getAdminChatId(): number | null {
	const raw = getEnvVar("ADMIN_TELEGRAM_ID");
	if (!raw) return null;
	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function getTelegramApiUrl(method: string): string | null {
	const token = getTelegramBotToken();
	if (!token) return null;
	return `https://api.telegram.org/bot${token}/${method}`;
}

function convertToTelegramMarkdown(text: string): string {
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
	result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const escapedCode = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
		return protect(`\`\`\`${lang}\n${escapedCode}\`\`\``);
	});
	result = result.replace(/`([^`\n]+)`/g, (_, code) => {
		const escaped = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
		return protect(`\`${escaped}\``);
	});
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
		const escapedText = linkText.replace(ALL_SPECIAL, "\\$&");
		const escapedUrl = url.replace(/[)]/g, "\\$&");
		return protect(`[${escapedText}](${escapedUrl})`);
	});
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`*${escaped}*`);
	});
	result = result.replace(/__([^_]+)__/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`__${escaped}__`);
	});
	result = result.replace(/\*([^*\n]+)\*/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`_${escaped}_`);
	});
	result = result.replace(/_([^_\n]+)_/g, (_, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`_${escaped}_`);
	});
	result = result.replace(/^(>+\s*)(.*)$/gm, (_, prefix, content) => {
		const escaped = content.replace(ALL_SPECIAL, "\\$&");
		return protect(`${prefix}${escaped}`);
	});

	result = result.replace(ALL_SPECIAL, "\\$&");
	for (const { placeholder, replacement } of protectedParts) {
		result = result.replace(placeholder, replacement);
	}
	return result;
}

function sanitizeTelegramFilename(filename: string): string {
	const base = basename(filename).replace(/[^a-zA-Z0-9._-]+/g, "_");
	const trimmed = base.replace(/^_+|_+$/g, "");
	return trimmed || "file";
}

export function normalizeWorkspaceFilePath(filePath: string): string | null {
	const resolvedWorkspace = resolve(workspacePath());
	const candidatePath = filePath.startsWith("/app/ws/")
		? filePath.replace("/app/ws", resolvedWorkspace)
		: filePath === "/app/ws"
			? resolvedWorkspace
			: isAbsolute(filePath)
				? filePath
				: resolve(resolvedWorkspace, filePath);
	const resolvedPath = resolve(candidatePath);
	const relativePath = relative(resolvedWorkspace, resolvedPath).replace(
		/\\/g,
		"/",
	);

	if (relativePath.startsWith("..")) {
		return null;
	}

	return resolvedPath;
}

export function buildWorkspaceAttachment(
	filePath: string,
): TelegramFileAttachment | null {
	const normalizedPath = normalizeWorkspaceFilePath(filePath);
	if (!normalizedPath || !existsSync(normalizedPath)) return null;

	const resolvedWorkspace = resolve(workspacePath());
	const relativePath = relative(resolvedWorkspace, normalizedPath).replace(
		/\\/g,
		"/",
	);
	return {
		filename: sanitizeTelegramFilename(normalizedPath),
		path: normalizedPath,
		downloadUrl: `/files/${relativePath}`,
	};
}

async function sendTelegramRawMessage(
	chatId: number,
	text: string,
	parseMode: "MarkdownV2" | "Markdown" | "HTML" | null = "MarkdownV2",
	abortSignal?: AbortSignal,
): Promise<boolean> {
	const url = getTelegramApiUrl("sendMessage");
	if (!url) return false;

	const linked = createLinkedAbortController({
		abortSignal,
		timeoutMs: TELEGRAM_REQUEST_TIMEOUT_MS,
		abortReason: "Telegram request aborted",
		timeoutReason: "Telegram request timed out",
	});

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				...(parseMode ? { parse_mode: parseMode } : {}),
			}),
			signal: linked.controller.signal,
		});

		const data = (await response.json()) as {
			ok: boolean;
			description?: string;
		};
		return data.ok;
	} finally {
		linked.cleanup();
	}
}

async function sendTelegramText(
	chatId: number,
	text: string,
	abortSignal?: AbortSignal,
): Promise<boolean> {
	const chunks: string[] = [];
	for (let index = 0; index < text.length; index += TELEGRAM_MESSAGE_LIMIT) {
		chunks.push(text.slice(index, index + TELEGRAM_MESSAGE_LIMIT));
	}
	if (chunks.length === 0) {
		chunks.push("");
	}

	for (const chunk of chunks) {
		const markdownMessage = convertToTelegramMarkdown(chunk);
		const sent = await sendTelegramRawMessage(
			chatId,
			markdownMessage,
			"MarkdownV2",
			abortSignal,
		);
		if (!sent) {
			const plain = await sendTelegramRawMessage(
				chatId,
				chunk,
				null,
				abortSignal,
			);
			if (!plain) return false;
		}
	}

	return true;
}

async function sendTelegramFile(
	chatId: number,
	filePath: string,
	abortSignal?: AbortSignal,
): Promise<TelegramFileAttachment | null> {
	const normalizedPath = normalizeWorkspaceFilePath(filePath);
	if (!normalizedPath || !existsSync(normalizedPath)) {
		return null;
	}

	const token = getTelegramBotToken();
	if (!token) return null;

	const ext = normalizedPath.split(".").pop()?.toLowerCase() || "";
	let url = "";
	let fieldName = "";
	if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
		url = `https://api.telegram.org/bot${token}/sendPhoto`;
		fieldName = "photo";
	} else if (["mp4", "mov", "webm"].includes(ext)) {
		url = `https://api.telegram.org/bot${token}/sendVideo`;
		fieldName = "video";
	} else {
		url = `https://api.telegram.org/bot${token}/sendDocument`;
		fieldName = "document";
	}

	const file = Bun.file(normalizedPath);
	const blob = new Blob([await file.arrayBuffer()]);
	const formData = new FormData();
	formData.append("chat_id", chatId.toString());
	formData.append(fieldName, blob, sanitizeTelegramFilename(normalizedPath));

	const linked = createLinkedAbortController({
		abortSignal,
		timeoutMs: TELEGRAM_REQUEST_TIMEOUT_MS,
		abortReason: "Telegram request aborted",
		timeoutReason: "Telegram request timed out",
	});

	try {
		const response = await fetch(url, {
			method: "POST",
			body: formData,
			signal: linked.controller.signal,
		});
		const data = (await response.json()) as {
			ok: boolean;
			description?: string;
		};
		if (!data.ok) {
			return null;
		}

		return buildWorkspaceAttachment(normalizedPath);
	} finally {
		linked.cleanup();
	}
}

export async function sendTelegramMessageToAdmin(
	text: string,
	files: string[] = [],
	abortSignal?: AbortSignal,
): Promise<SendTelegramResult> {
	const chatId = getAdminChatId();
	const token = getTelegramBotToken();
	const warnings: string[] = [];
	const attachments: TelegramFileAttachment[] = [];

	if (!token) {
		return {
			ok: false,
			messageDelivered: false,
			attachments,
			warnings: ["TELEGRAM_BOT_TOKEN is not configured"],
		};
	}

	if (!chatId) {
		return {
			ok: false,
			messageDelivered: false,
			attachments,
			warnings: ["ADMIN_TELEGRAM_ID is not configured or invalid"],
		};
	}

	const textSent =
		text.trim().length === 0
			? true
			: await sendTelegramText(chatId, text, abortSignal);
	if (!textSent) {
		warnings.push("Failed to send Telegram text");
	}

	for (const filePath of files) {
		const attachment = await sendTelegramFile(chatId, filePath, abortSignal);
		if (attachment) {
			attachments.push(attachment);
		} else {
			warnings.push(`Failed to send file: ${filePath}`);
		}
	}

	return {
		ok: textSent && warnings.length === 0,
		messageDelivered: textSent,
		attachments,
		warnings,
	};
}
