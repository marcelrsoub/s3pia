import { generateText } from "ai";
import { createConfiguredLanguageModel } from "./model.js";

export interface TelegramAckContext {
	content: string;
	hasFileAttachment: boolean;
	backlogCount: number;
}

export interface TelegramAckComposerOptions {
	timeoutMs?: number;
	fallbackMessage?: string;
	generate?: (
		context: TelegramAckContext,
		signal: AbortSignal,
	) => Promise<string>;
}

const DEFAULT_FALLBACK_MESSAGE = "I'm on it. I'll reply when it's ready.";
const LONG_MESSAGE_THRESHOLD = 240;

export function shouldSendQueuedAck(context: TelegramAckContext): boolean {
	return (
		context.hasFileAttachment ||
		context.content.trim().length >= LONG_MESSAGE_THRESHOLD ||
		context.backlogCount > 0
	);
}

function isUsableAckText(text: string): boolean {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (!normalized) return false;
	if (normalized.length > 120) return false;
	if (normalized.includes("\n")) return false;
	if (/[`*_[\]{}<>]/.test(normalized)) return false;
	if (/\b(queue|queued|backlog|internal|agent|model)\b/i.test(normalized)) {
		return false;
	}
	if (!/^(I\b|I['’]m\b|I['’]ll\b|I['’]ve\b|Let me\b)/i.test(normalized)) {
		return false;
	}
	return true;
}

async function generateAckFromModel(
	context: TelegramAckContext,
	signal: AbortSignal,
): Promise<string> {
	const model = createConfiguredLanguageModel();
	const result = await generateText({
		model,
		system:
			"You write concise Telegram waiting messages. Return exactly one short sentence in first person. Do not mention queues, timing estimates, or internal machinery. Do not use markdown.",
		prompt: [
			"Create a short acknowledgement for a Telegram user.",
			"Keep it calm, human, and direct.",
			"Return only the message.",
			`Task length: ${context.content.trim().length} characters.`,
			`Attachment present: ${context.hasFileAttachment ? "yes" : "no"}.`,
			`Backlog count: ${context.backlogCount}.`,
		].join("\n"),
		maxOutputTokens: 24,
		temperature: 0.6,
		maxRetries: 0,
		abortSignal: signal,
	});

	return result.text;
}

export async function composeQueuedTelegramAck(
	context: TelegramAckContext,
	options: TelegramAckComposerOptions = {},
): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 1_000;
	const fallbackMessage = options.fallbackMessage ?? DEFAULT_FALLBACK_MESSAGE;
	const generate = options.generate ?? generateAckFromModel;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const candidate = await generate(context, controller.signal);
		if (isUsableAckText(candidate)) {
			return candidate.trim().replace(/\s+/g, " ");
		}
		return fallbackMessage;
	} catch {
		return fallbackMessage;
	} finally {
		clearTimeout(timer);
	}
}

export const DEFAULT_QUEUED_ACK = DEFAULT_FALLBACK_MESSAGE;
