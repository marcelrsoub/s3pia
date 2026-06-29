export interface TelegramAckContext {
	content: string;
	hasFileAttachment: boolean;
	isBusy: boolean;
}

export interface TelegramAckComposerOptions {
	fallbackMessage?: string;
	fallbackMessages?: readonly string[];
	random?: () => number;
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
	_context: TelegramAckContext,
	options: TelegramAckComposerOptions = {},
): Promise<string> {
	const fallbackMessage = options.fallbackMessage;
	const fallbackMessages =
		options.fallbackMessages ?? DEFAULT_FALLBACK_MESSAGES;
	const random = options.random ?? Math.random;

	return fallbackMessage || pickRandomFallbackMessage(fallbackMessages, random);
}

export const DEFAULT_LIVE_ACK = DEFAULT_FALLBACK_MESSAGES[0];
