import {
	conversationStore,
	type Message,
	TELEGRAM_CONVERSATION_ID,
} from "./conversation.js";
import { estimateTokens } from "./openrouter.js";

interface ChunkedTextResult {
	kind: "chunked_text";
	label: string;
	preview: string;
	charsReturned: number;
	totalChars: number;
	truncated: boolean;
	nextOffset: number | null;
	offset: number;
	remainingChars: number;
	startLine?: number;
	endLine?: number;
	remainingLines?: number;
	lineWindowApplied?: boolean;
	message?: string;
}

interface PromptMessage {
	role: "user" | "assistant";
	content: string;
}

export interface ThreadStateStore {
	get(conversationId: string):
		| {
				metadata?: {
					preferredLanguage?: string;
					lastIntakeKind?: string;
					lastIntakeNextStep?: string;
					lastIntakeGoal?: string;
					activeRunId?: string;
					activeRunSource?: string;
					activeRunStatus?: string;
					activeRunPreview?: string;
					activeRunQuestion?: string;
					activeRunStartedAt?: number;
					activeRunUpdatedAt?: number;
				};
				lastActivity: number;
		  }
		| undefined;
	getRecentMessages(conversationId: string, limit: number): Message[];
	getMessagesSince(conversationId: string, sinceTimestamp: number): Message[];
}

export function compactText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const headLength = Math.max(0, Math.floor(maxChars * 0.65));
	const tailLength = Math.max(0, maxChars - headLength - 64);
	const head = text.slice(0, headLength).trimEnd();
	const tail = text
		.slice(Math.max(headLength, text.length - tailLength))
		.trimStart();
	return `${head}\n\n[...omitted ${text.length - head.length - tail.length} chars...]\n\n${tail}`;
}

export function buildThreadSnapshot(messages: Message[]): string | null {
	if (messages.length === 0) return null;
	const recent = messages.slice(-12);
	const lastUser = [...recent].reverse().find((msg) => msg.role === "user");
	const assistantSummaries = recent
		.filter((msg) => msg.role === "assistant")
		.slice(-3)
		.map((msg) => compactText(msg.content, 280));
	const fileReferences = recent
		.flatMap((msg) => msg.files?.map((file) => file.path) ?? [])
		.slice(-5);

	const lines = [
		lastUser
			? `Latest user context:\n${compactText(lastUser.content, 600)}`
			: null,
		assistantSummaries.length > 0
			? `Recent assistant context:\n${assistantSummaries
					.map((summary, index) => `${index + 1}. ${summary}`)
					.join("\n")}`
			: null,
		fileReferences.length > 0
			? `Referenced files:\n${fileReferences.map((path) => `- ${path}`).join("\n")}`
			: null,
	].filter(Boolean);

	return lines.length > 0 ? lines.join("\n\n") : null;
}

export function takeMessagesWithinBudget(
	messages: PromptMessage[],
	tokenBudget: number,
): { messages: PromptMessage[]; droppedCount: number } {
	const selected: PromptMessage[] = [];
	let usedTokens = 0;
	let droppedCount = 0;

	for (const message of messages) {
		const cost = estimateTokens(message.content) + 16;
		if (selected.length > 0 && usedTokens + cost > tokenBudget) {
			droppedCount++;
			continue;
		}

		selected.push(message);
		usedTokens += cost;
	}

	return { messages: selected, droppedCount };
}

export function buildChunkedTextResult(
	text: string,
	maxChars: number,
	options: {
		label: string;
		offset?: number;
		totalLines?: number;
		startLine?: number;
		endLine?: number;
		lineWindowApplied?: boolean;
	},
): ChunkedTextResult {
	const offset = options.offset ?? 0;
	const slice = text.slice(offset, offset + maxChars);
	const nextOffset =
		offset + slice.length < text.length ? offset + slice.length : null;

	return {
		kind: "chunked_text",
		label: options.label,
		preview: slice,
		charsReturned: slice.length,
		totalChars: text.length,
		truncated: nextOffset !== null || offset > 0,
		nextOffset,
		offset,
		remainingChars: Math.max(0, text.length - (offset + slice.length)),
		startLine: options.startLine,
		endLine: options.endLine,
		remainingLines:
			options.totalLines && options.endLine
				? Math.max(0, options.totalLines - options.endLine)
				: undefined,
		lineWindowApplied: options.lineWindowApplied,
		message:
			nextOffset !== null || offset > 0
				? `Content exceeded the current model budget. Read the next chunk with offset ${nextOffset ?? offset + slice.length}.`
				: undefined,
	};
}

function compactThreadText(text: string, maxChars = 180): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function summarizeThreadMessage(message: Message): ThreadStateMessage {
	return {
		role: message.role,
		timestamp: message.timestamp,
		source: message.source,
		preview: compactThreadText(message.content),
	};
}

interface ThreadStateMessage {
	role: Message["role"];
	timestamp: number;
	source?: Message["source"];
	preview: string;
}

interface ThreadStateSnapshot {
	conversationId: string;
	checkpointAt: number;
	metadata: {
		preferredLanguage?: string;
		lastIntakeKind?: string;
		lastIntakeNextStep?: string;
		lastIntakeGoal?: string;
		activeRunId?: string;
		activeRunSource?: string;
		activeRunStatus?: string;
		activeRunPreview?: string;
		activeRunQuestion?: string;
		activeRunStartedAt?: number;
		activeRunUpdatedAt?: number;
	};
	activeRun: {
		id?: string;
		source?: string;
		status: string;
		preview?: string;
		question?: string;
		startedAt?: number;
		updatedAt?: number;
	} | null;
	recentMessages: ThreadStateMessage[];
	newUserUpdates: number;
	latestUserMessage: ThreadStateMessage | null;
	summary: string;
}

export function buildThreadState(
	conversationId = TELEGRAM_CONVERSATION_ID,
	sinceTimestamp?: number,
	limit = 8,
	store: ThreadStateStore = conversationStore,
): ThreadStateSnapshot {
	const conversation = store.get(conversationId);
	const metadata = conversation?.metadata || {};
	const activeRunStatus =
		metadata.activeRunStatus === "running" ||
		metadata.activeRunStatus === "blocked"
			? metadata.activeRunStatus
			: undefined;
	const checkpointAt =
		sinceTimestamp ??
		metadata.activeRunUpdatedAt ??
		metadata.activeRunStartedAt ??
		conversation?.lastActivity ??
		0;
	const activeRun = activeRunStatus
		? {
				id: metadata.activeRunId,
				source: metadata.activeRunSource,
				status: activeRunStatus,
				preview: metadata.activeRunPreview,
				question: metadata.activeRunQuestion,
				startedAt: metadata.activeRunStartedAt,
				updatedAt: metadata.activeRunUpdatedAt,
			}
		: null;

	const sourceMessages =
		sinceTimestamp !== undefined
			? store.getMessagesSince(conversationId, checkpointAt)
			: store.getRecentMessages(conversationId, limit);
	const recentMessages = sourceMessages
		.slice(-Math.max(1, limit))
		.map(summarizeThreadMessage);
	const userMessages = recentMessages.filter(
		(message) => message.role === "user",
	);
	const latestUserMessage = userMessages.at(-1) || null;
	const newUserUpdates = userMessages.length;

	const summaryParts = [
		activeRun
			? `Live run ${activeRun.status}: ${activeRun.preview || "unknown"}`
			: "No active run.",
		newUserUpdates > 0
			? `Recent user updates: ${newUserUpdates}`
			: "No recent user updates.",
		latestUserMessage
			? `Latest user message: ${latestUserMessage.preview}`
			: null,
	].filter(Boolean);

	return {
		conversationId,
		checkpointAt,
		metadata: {
			preferredLanguage: metadata.preferredLanguage,
			lastIntakeKind: metadata.lastIntakeKind,
			lastIntakeNextStep: metadata.lastIntakeNextStep,
			lastIntakeGoal: metadata.lastIntakeGoal,
			activeRunId: metadata.activeRunId,
			activeRunSource: metadata.activeRunSource,
			activeRunStatus: activeRunStatus,
			activeRunPreview: metadata.activeRunPreview,
			activeRunQuestion: metadata.activeRunQuestion,
			activeRunStartedAt: metadata.activeRunStartedAt,
			activeRunUpdatedAt: metadata.activeRunUpdatedAt,
		},
		activeRun,
		recentMessages,
		newUserUpdates,
		latestUserMessage,
		summary: summaryParts.join(" "),
	};
}
