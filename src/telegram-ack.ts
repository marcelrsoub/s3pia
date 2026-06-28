import { generateText } from "ai";
import { createConfiguredLanguageModel } from "./model.js";

export interface TelegramAckContext {
	content: string;
	hasFileAttachment: boolean;
	isBusy: boolean;
}

export interface TelegramAckComposerOptions {
	timeoutMs?: number;
	fallbackMessage?: string;
	fallbackMessages?: readonly string[];
	random?: () => number;
	generate?: (
		context: TelegramAckContext,
		signal: AbortSignal,
	) => Promise<string>;
}

const DEFAULT_FALLBACK_MESSAGES = [
	"I'm on it. I'll take a look now.",
	"Got it. I'm checking this now.",
	"I'm handling it now.",
	"I'll get to this next.",
	"I'm working on it now.",
] as const;
const LONG_MESSAGE_THRESHOLD = 240;

export function shouldSendLiveAck(context: TelegramAckContext): boolean {
	return (
		context.hasFileAttachment ||
		context.content.trim().length >= LONG_MESSAGE_THRESHOLD ||
		context.isBusy
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
			"You write concise Telegram live-run acknowledgements. Return exactly one short sentence in first person. Do not mention queues, timing estimates, or internal machinery. Do not use markdown.",
		prompt: [
			"Create a short acknowledgement for a Telegram user.",
			"Keep it calm, human, and direct.",
			"Return only the message.",
			`Request length: ${context.content.trim().length} characters.`,
			`Attachment present: ${context.hasFileAttachment ? "yes" : "no"}.`,
			`Agent busy: ${context.isBusy ? "yes" : "no"}.`,
		].join("\n"),
		maxOutputTokens: 24,
		temperature: 0.6,
		maxRetries: 0,
		abortSignal: signal,
	});

	return result.text;
}

function pickRandomFallbackMessage(
	messages: readonly string[],
	random: () => number,
): string {
	if (messages.length === 0) {
		return DEFAULT_FALLBACK_MESSAGES[0];
	}

	const index = Math.min(
		messages.length - 1,
		Math.max(0, Math.floor(random() * messages.length)),
	);
	return messages[index] || DEFAULT_FALLBACK_MESSAGES[0];
}

export async function composeLiveTelegramAck(
	context: TelegramAckContext,
	options: TelegramAckComposerOptions = {},
): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 1_000;
	const fallbackMessage = options.fallbackMessage;
	const fallbackMessages =
		options.fallbackMessages ?? DEFAULT_FALLBACK_MESSAGES;
	const random = options.random ?? Math.random;
	const generate = options.generate ?? generateAckFromModel;
	const pickFallback = (): string =>
		fallbackMessage || pickRandomFallbackMessage(fallbackMessages, random);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const candidate = await generate(context, controller.signal);
		if (isUsableAckText(candidate)) {
			return candidate.trim().replace(/\s+/g, " ");
		}
		return pickFallback();
	} catch {
		return pickFallback();
	} finally {
		clearTimeout(timer);
	}
}

export const DEFAULT_LIVE_ACK = DEFAULT_FALLBACK_MESSAGES[0];
