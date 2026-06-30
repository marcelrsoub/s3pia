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

const TELEGRAM_MESSAGE_CHUNK_LIMIT = 3600;
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

function normalizeTelegramMarkdownStructure(text: string): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const normalized: string[] = [];
	let inCodeFence = false;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === undefined) {
			continue;
		}
		const trimmed = line.trimStart();
		const isFence = trimmed.startsWith("```");
		if (isFence) {
			inCodeFence = !inCodeFence;
			normalized.push(line);
			continue;
		}

		if (inCodeFence) {
			normalized.push(line);
			continue;
		}

		const inlineTable = extractCompressedTableLine(line);
		if (inlineTable) {
			if (inlineTable.prefix) {
				normalized.push(inlineTable.prefix);
			}
			normalized.push("```");
			normalized.push(inlineTable.renderedTable);
			normalized.push("```");
			if (inlineTable.suffix) {
				normalized.push(inlineTable.suffix);
			}
			continue;
		}

		const nextLine = lines[index + 1];
		if (
			nextLine &&
			isMarkdownTableRow(line) &&
			isMarkdownTableSeparatorLine(nextLine)
			) {
				const tableLines = [line, nextLine];
				let cursor = index + 2;
				while (cursor < lines.length) {
					const tableLine = lines[cursor];
					if (tableLine === undefined || !isMarkdownTableRow(tableLine)) {
						break;
					}
					tableLines.push(tableLine);
					cursor += 1;
				}

			const renderedTable = renderTelegramTableBlock(tableLines);
			normalized.push("```");
			normalized.push(renderedTable);
			normalized.push("```");
			index = cursor - 1;
			continue;
		}

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			const title = heading[2]?.trim() ?? "";
			normalized.push(title.length > 0 ? `**${title}**` : "");
			continue;
		}

		const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
		if (bullet) {
			const indent = bullet[1] ?? "";
			const item = bullet[2]?.trim() ?? "";
			normalized.push(`${indent}• ${item}`);
			continue;
		}

		if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
			normalized.push("");
			continue;
		}

		normalized.push(line);
	}

	return normalized.join("\n");
}

function isMarkdownTableCell(text: string): boolean {
	return /^:?-{3,}:?$/.test(text.trim());
}

function splitMarkdownTableCells(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) {
		trimmed = trimmed.slice(1);
	}
	if (trimmed.endsWith("|")) {
		trimmed = trimmed.slice(0, -1);
	}

	return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableRow(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) return false;
	const cells = splitMarkdownTableCells(trimmed);
	return cells.length >= 2 && cells.some((cell) => cell.length > 0);
}

function isMarkdownTableSeparatorLine(line: string): boolean {
	const cells = splitMarkdownTableCells(line);
	if (cells.length < 2) return false;
	return cells.every((cell) => isMarkdownTableCell(cell));
}

function extractCompressedTableLine(
	line: string,
): { prefix: string; renderedTable: string; suffix: string } | null {
	const firstPipe = line.indexOf("|");
	const lastPipe = line.lastIndexOf("|");
	if (firstPipe < 0 || lastPipe <= firstPipe) {
		return null;
	}

	const prefix = line.slice(0, firstPipe).trimEnd();
	const suffix = line.slice(lastPipe + 1).trimStart();
	const tableText = line.slice(firstPipe, lastPipe + 1).trim();
	if (!tableText.includes("|")) return null;

	const cells = tableText
		.split("|")
		.map((cell) => cell.trim())
		.filter((cell) => cell.length > 0);
	if (cells.length < 4) {
		return null;
	}

	for (let index = 0; index < cells.length; index += 1) {
		const cell = cells[index];
		if (cell === undefined || !isMarkdownTableCell(cell)) continue;

		let separatorLength = 0;
		while (
			index + separatorLength < cells.length &&
			cells[index + separatorLength] !== undefined &&
			isMarkdownTableCell(cells[index + separatorLength] as string)
		) {
			separatorLength += 1;
		}

		if (separatorLength < 2) {
			continue;
		}

		if (index !== separatorLength) {
			continue;
		}

		const dataCells = cells.slice(index + separatorLength);
		if (dataCells.length === 0 || dataCells.length % separatorLength !== 0) {
			continue;
		}

		const renderedTable = renderTelegramTableBlock([
			`| ${cells.slice(0, separatorLength).join(" | ")} |`,
			`| ${cells.slice(index, index + separatorLength).join(" | ")} |`,
			...chunkCells(dataCells, separatorLength).map(
				(row) => `| ${row.join(" | ")} |`,
			),
		]);

		return { prefix, renderedTable, suffix };
	}

	return null;
}

function chunkCells(cells: string[], width: number): string[][] {
	const rows: string[][] = [];
	for (let index = 0; index < cells.length; index += width) {
		rows.push(cells.slice(index, index + width));
	}
	return rows;
}

function renderTelegramTableBlock(lines: string[]): string {
	const headerLine = lines[0] ?? "";
	const rows = [headerLine, ...lines.slice(2)].map((line) =>
		splitMarkdownTableCells(line),
	);
	if (rows.length === 0) {
		return "";
	}
	const columnCount = Math.max(...rows.map((row) => row.length));
	const normalizedRows = rows.map((row) => {
		const copy = [...row];
		while (copy.length < columnCount) {
			copy.push("");
		}
		return copy;
	});

	const widths = Array.from({ length: columnCount }, (_, columnIndex) =>
		Math.max(
			3,
			...normalizedRows.map((row) => row[columnIndex]?.length ?? 0),
		),
	);

	const formatRow = (row: string[]): string =>
		`| ${row
			.map((cell, columnIndex) => cell.padEnd(widths[columnIndex] ?? 3))
			.join(" | ")} |`;

	const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
	const header = normalizedRows[0] ?? [];
	const dataRows = normalizedRows.slice(1);
	const renderedRows = [
		formatRow(header),
		separator,
		...dataRows.map((row) => formatRow(row)),
	];

	return renderedRows.join("\n");
}

function splitLongTelegramParagraph(
	paragraph: string,
	maxChars: number,
): string[] {
	if (paragraph.length <= maxChars) {
		return [paragraph];
	}

	const lines = paragraph.split("\n");
	const chunks: string[] = [];
	let current = "";

	for (const line of lines) {
		if (current.length === 0) {
			if (line.length <= maxChars) {
				current = line;
				continue;
			}

			for (let offset = 0; offset < line.length; offset += maxChars) {
				chunks.push(line.slice(offset, offset + maxChars));
			}
			continue;
		}

		const candidate = `${current}\n${line}`;
		if (candidate.length <= maxChars) {
			current = candidate;
			continue;
		}

		chunks.push(current);
		current = "";

		if (line.length <= maxChars) {
			current = line;
			continue;
		}

		for (let offset = 0; offset < line.length; offset += maxChars) {
			chunks.push(line.slice(offset, offset + maxChars));
		}
	}

	if (current.length > 0) {
		chunks.push(current);
	}

	return chunks;
}

function splitTelegramTextIntoChunks(
	text: string,
	maxChars = TELEGRAM_MESSAGE_CHUNK_LIMIT,
): string[] {
	const normalized = normalizeTelegramMarkdownStructure(text).trim();
	if (!normalized) {
		return [""];
	}

	const paragraphs: string[] = [];
	let currentLines: string[] = [];
	let inCodeFence = false;

	const flushParagraph = (): void => {
		if (currentLines.length === 0) {
			return;
		}
		const paragraph = currentLines.join("\n").trimEnd();
		if (paragraph.length > 0) {
			paragraphs.push(paragraph);
		}
		currentLines = [];
	};

	for (const line of normalized.split("\n")) {
		const trimmed = line.trimStart();
		const isFence = trimmed.startsWith("```");
		if (isFence) {
			inCodeFence = !inCodeFence;
			currentLines.push(line);
			continue;
		}

		if (!inCodeFence && line.trim().length === 0) {
			flushParagraph();
			continue;
		}

		currentLines.push(line);
	}

	flushParagraph();

	const chunks: string[] = [];
	let current = "";

	for (const paragraph of paragraphs) {
		if (current.length === 0) {
			if (paragraph.length <= maxChars) {
				current = paragraph;
			} else {
				chunks.push(...splitLongTelegramParagraph(paragraph, maxChars));
			}
			continue;
		}

		const candidate = `${current}\n\n${paragraph}`;
		if (candidate.length <= maxChars) {
			current = candidate;
			continue;
		}

		chunks.push(current);
		current = "";

		if (paragraph.length <= maxChars) {
			current = paragraph;
		} else {
			chunks.push(...splitLongTelegramParagraph(paragraph, maxChars));
		}
	}

	if (current.length > 0) {
		chunks.push(current);
	}

	return chunks.length > 0 ? chunks : [""];
}

function escapeTelegramHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeTelegramHtmlAttribute(text: string): string {
	return escapeTelegramHtml(text).replace(/"/g, "&quot;");
}

function formatTelegramHtml(text: string): string {
	const structuredText = normalizeTelegramMarkdownStructure(text);

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

	let result = structuredText;
	result = result.replace(/```(?:[\w-]*)\n?([\s\S]*?)```/g, (_, code) => {
		return protect(`<pre>${escapeTelegramHtml(code)}</pre>`);
	});
	result = result.replace(/`([^`\n]+)`/g, (_, code) => {
		return protect(`<code>${escapeTelegramHtml(code)}</code>`);
	});
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
		return protect(
			`<a href="${escapeTelegramHtmlAttribute(url)}">${escapeTelegramHtml(
				linkText,
			)}</a>`,
		);
	});
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
		return protect(`<b>${escapeTelegramHtml(content)}</b>`);
	});
	result = result.replace(/__([^_]+)__/g, (_, content) => {
		return protect(`<b>${escapeTelegramHtml(content)}</b>`);
	});
	result = result.replace(/\*([^*\n]+)\*/g, (_, content) => {
		return protect(`<i>${escapeTelegramHtml(content)}</i>`);
	});
	result = result.replace(/_([^_\n]+)_/g, (_, content) => {
		return protect(`<i>${escapeTelegramHtml(content)}</i>`);
	});
	result = result.replace(/^(>+\s*)(.*)$/gm, (_, prefix, content) => {
		const quoteLevel = String(prefix).replace(/\s/g, "").length;
		const marker = quoteLevel > 1 ? `${">".repeat(quoteLevel - 1)} ` : "";
		return protect(
			`<blockquote>${escapeTelegramHtml(marker + content)}</blockquote>`,
		);
	});

	result = escapeTelegramHtml(result);
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
	format: "html" | "plain",
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
				...(format === "html" ? { parse_mode: "HTML" } : {}),
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
	const chunks = splitTelegramTextIntoChunks(text);
	for (const chunk of chunks) {
		const htmlMessage = formatTelegramHtml(chunk);
		const sent = await sendTelegramRawMessage(
			chatId,
			htmlMessage,
			"html",
			abortSignal,
		);
		if (!sent) {
			const plain = await sendTelegramRawMessage(
				chatId,
				chunk,
				"plain",
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
