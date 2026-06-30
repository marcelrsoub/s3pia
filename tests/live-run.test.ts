import { expect, test } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	type LiveConversationSession,
	LiveRunCoordinator,
	normalizeLegacySessionAssistantContent,
} from "../src/live-run";
import type { ConversationMetadata, Message } from "../src/conversation";

type MockEvent = {
	type: string;
	[key: string]: unknown;
};

function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		const tick = async () => {
			if (check()) {
				resolve();
				return;
			}
			if (Date.now() >= deadline) {
				reject(new Error("Timed out waiting for live run state"));
				return;
			}
			await Bun.sleep(10);
			void tick();
		};
		void tick();
	});
}

function userMessage(content: string): Message {
	return {
		role: "user",
		content,
		timestamp: Date.now(),
		source: "telegram",
	};
}

function assistantMessage(content: string): Message {
	return {
		role: "assistant",
		content,
		timestamp: Date.now(),
		source: "telegram",
	};
}

function legacyAssistantSessionMessage(content: string) {
	return {
		role: "assistant",
		content,
		api: "openrouter",
		provider: "openrouter",
		model: "deepseek/deepseek-v4-pro",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createMockStore(initialMessages: Message[] = []) {
	const conversations = new Map<
		string,
		{
			metadata: ConversationMetadata;
			messages: Message[];
			lastActivity: number;
		}
	>();

	const ensureConversation = (id: string) => {
		let conversation = conversations.get(id);
		if (!conversation) {
			conversation = {
				metadata: {},
				messages: [],
				lastActivity: Date.now(),
			};
			conversations.set(id, conversation);
		}
		return conversation;
	};

	const seed = ensureConversation("telegram");
	seed.messages.push(...initialMessages);
	seed.lastActivity = seed.messages.at(-1)?.timestamp ?? Date.now();

	return {
		get(id: string) {
			const conversation = conversations.get(id);
			if (!conversation) return undefined;
			return {
				metadata: conversation.metadata,
				lastActivity: conversation.lastActivity,
			};
		},
		create(id: string) {
			return { metadata: ensureConversation(id).metadata };
		},
		getMetadata(conversationId: string) {
			return ensureConversation(conversationId).metadata;
		},
		getRecentMessages(conversationId: string, limit = 8) {
			return ensureConversation(conversationId).messages
				.slice(-Math.max(0, limit));
		},
		getMessagesSince(conversationId: string, sinceTimestamp: number) {
			return ensureConversation(conversationId).messages.filter(
				(message) => message.timestamp >= sinceTimestamp,
			);
		},
		getMessagesForAI(conversationId: string) {
			return ensureConversation(conversationId).messages.filter(
				(message) => message.role !== "worker" || message.workerStatus !== "failed",
			);
		},
		updateMetadata(
			conversationId: string,
			metadata: Partial<ConversationMetadata>,
		) {
			const conversation = ensureConversation(conversationId);
			conversation.metadata = { ...conversation.metadata, ...metadata };
			conversation.lastActivity = Date.now();
		},
		addMessage(
			conversationId: string,
			role: "user" | "assistant" | "worker",
			content: string,
			source?: "web" | "telegram",
			workerType?: "tool" | "bash",
			workerStatus?: "started" | "completed" | "failed",
			files?: Message["files"],
		) {
			const conversation = ensureConversation(conversationId);
			const message: Message = {
				role,
				content,
				timestamp: Date.now(),
				source,
				workerType,
				workerStatus,
				files,
			};
			conversation.messages.push(message);
			conversation.lastActivity = message.timestamp;
		},
	};
}

function createMockSession(): LiveConversationSession & {
	emit(event: MockEvent): void;
	sendUserMessageCalls: Array<{
		content: string;
		options?: { deliverAs?: "steer" | "followUp" };
	}>;
	steerCalls: string[];
	followUpCalls: string[];
	abortCalls: number;
	clearQueueCalls: number;
} {
	const listeners = new Set<(event: MockEvent) => void>();

	return {
		sessionId: "mock-session-1",
		sessionFile: "/tmp/mock.pi",
		isStreaming: false,
		pendingMessageCount: 0,
		sendUserMessageCalls: [],
		steerCalls: [],
		followUpCalls: [],
		abortCalls: 0,
		clearQueueCalls: 0,
		subscribe(listener) {
			listeners.add(listener as (event: MockEvent) => void);
			return () => listeners.delete(listener as (event: MockEvent) => void);
		},
		async sendUserMessage(content, options) {
			this.sendUserMessageCalls.push({ content, options });
		},
		async steer(text) {
			this.steerCalls.push(text);
		},
		async followUp(text) {
			this.followUpCalls.push(text);
		},
		async abort() {
			this.abortCalls += 1;
			this.isStreaming = false;
			this.pendingMessageCount = 0;
		},
		clearQueue() {
			this.clearQueueCalls += 1;
			this.pendingMessageCount = 0;
			return {
				steering: [],
				followUp: [],
			};
		},
		getLastAssistantText() {
			return undefined;
		},
		dispose() {},
		emit(event: MockEvent) {
			for (const listener of listeners) {
				listener(event);
			}
		},
	};
}

test("keeps send_message as the only user-visible reply during a run", async () => {
	const store = createMockStore([
		userMessage("Please summarize the attached notes."),
	]);
	const session = createMockSession();
	const deliveries: string[] = [];
	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async (text) => {
			deliveries.push(text);
			return true;
		},
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Please summarize the attached notes.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	session.emit({
		type: "tool_execution_start",
		toolCallId: "tool-1",
		toolName: "send_message",
		args: { message: "Working on it." },
	});
	session.emit({
		type: "tool_execution_end",
		toolCallId: "tool-1",
		toolName: "send_message",
		result: {
			content: [{ type: "text", text: "Delivered the update to Telegram." }],
			details: { delivered: true },
		},
		isError: false,
	});
	session.emit({
		type: "turn_end",
		message: assistantMessage("Final summary"),
		toolResults: [],
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(session.sendUserMessageCalls).toHaveLength(1);
	expect(deliveries).toHaveLength(0);
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("does not auto-deliver a final assistant reply without send_message", async () => {
	const store = createMockStore([userMessage("Summarize the task.")]);
	const session = createMockSession();
	const deliveries: string[] = [];
	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async (text) => {
			deliveries.push(text);
			return true;
		},
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Summarize the task.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	session.emit({
		type: "turn_end",
		message: assistantMessage(""),
		toolResults: [],
	});
	session.emit({
		type: "agent_end",
		messages: [assistantMessage("Fallback response from agent_end")],
		willRetry: false,
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(deliveries).toHaveLength(0);
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("does not auto-deliver assistant errors without send_message", async () => {
	const store = createMockStore([userMessage("Do the thing.")]);
	const session = createMockSession();
	const deliveries: string[] = [];
	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async (text) => {
			deliveries.push(text);
			return true;
		},
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Do the thing.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	session.emit({
		type: "turn_end",
		message: {
			...assistantMessage(""),
			stopReason: "error",
			errorMessage: "OpenRouter request failed",
		},
		toolResults: [],
	});
	session.emit({
		type: "agent_end",
		messages: [
			{
				...assistantMessage(""),
				stopReason: "error",
				errorMessage: "OpenRouter request failed",
			},
		],
		willRetry: false,
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(deliveries).toHaveLength(0);
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("repairs legacy assistant session content before resuming Pi", () => {
	const session = SessionManager.inMemory();
	session.appendMessage(
		{
			role: "user",
			content: "Hi",
			timestamp: Date.now(),
		} as Parameters<SessionManager["appendMessage"]>[0],
	);
	session.appendMessage(
		legacyAssistantSessionMessage(
			"I'm here, send me what you want me to work on.",
		) as Parameters<SessionManager["appendMessage"]>[0],
	);

	const migrated = normalizeLegacySessionAssistantContent(session);

	expect(migrated).toBe(true);
	const assistantEntry = session.getEntries().find((entry) => {
		if (entry.type !== "message") {
			return false;
		}
		return entry.message.role === "assistant";
	});
	if (!assistantEntry || assistantEntry.type !== "message") {
		throw new Error("Expected a migrated assistant message entry");
	}
	if (assistantEntry.message.role !== "assistant") {
		throw new Error("Expected an assistant message entry");
	}
	const assistantMessage = assistantEntry.message as { content: unknown };
	expect(Array.isArray(assistantMessage.content)).toBe(true);
	expect(assistantMessage.content).toEqual([
		{
			type: "text",
			text: "I'm here, send me what you want me to work on.",
		},
	]);
});

test("steers the same session when a follow-up arrives during work", async () => {
	const store = createMockStore([userMessage("Analyze the draft.")]);
	const session = createMockSession();

	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async () => true,
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Analyze the draft.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	session.isStreaming = true;
	session.pendingMessageCount = 1;

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "live_update",
		preview: "Actually focus on section 2.",
	});

	await waitFor(() => session.steerCalls.length === 1);
	expect(session.steerCalls[0]).toContain("section 2");
	expect(coordinator.getStatusSnapshot("telegram").rerunRequested).toBe(true);

	session.isStreaming = false;
	session.pendingMessageCount = 0;
	session.emit({ type: "queue_update", steering: [], followUp: [] });
	session.emit({
		type: "turn_end",
		message: assistantMessage("Updated the draft"),
		toolResults: [],
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(session.sendUserMessageCalls).toHaveLength(1);
	expect(session.steerCalls).toHaveLength(1);
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("uses the operator steer path while the run is busy", async () => {
	const store = createMockStore([userMessage("Review the report.")]);
	const session = createMockSession();
	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async () => true,
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Review the report.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	session.isStreaming = true;
	session.pendingMessageCount = 1;

	coordinator.requestRun({
		conversationId: "telegram",
		source: "manual",
		kind: "steer",
		preview: "Focus on the executive summary.",
	});

	await waitFor(() => session.steerCalls.length === 1);
	expect(session.steerCalls[0]).toContain("executive summary");
	expect(coordinator.getStatusSnapshot("telegram").rerunRequested).toBe(true);
});

test("resumes a blocked run in the same conversation after an answer arrives", async () => {
	const store = createMockStore([userMessage("Update the report.")]);
	const session = createMockSession();
	const deliveries: string[] = [];
	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async (text) => {
			deliveries.push(text);
			return true;
		},
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Update the report.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	session.emit({
		type: "tool_execution_start",
		toolCallId: "tool-ask",
		toolName: "ask_user",
		args: { question: "Which file should I edit?" },
	});
	session.emit({
		type: "tool_execution_end",
		toolCallId: "tool-ask",
		toolName: "ask_user",
		result: {
			content: [{ type: "text", text: "I asked the user and am waiting." }],
			details: {
				blocked: true,
				question: "Which file should I edit?",
			},
		},
		isError: false,
	});
	session.emit({
		type: "turn_end",
		message: assistantMessage("Need the target filename."),
		toolResults: [],
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "blocked");
	expect(coordinator.getStatusSnapshot("telegram").currentRun?.question).toBe(
		"Which file should I edit?",
	);

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "blocked_answer",
		preview: "Use file B instead.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 2);
	expect(session.sendUserMessageCalls[1]?.content).toContain("Use file B instead.");

	session.emit({ type: "turn_start" });
	session.emit({
		type: "turn_end",
		message: assistantMessage("updated file-b.txt"),
		toolResults: [],
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(deliveries).toHaveLength(0);
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("cancels a running live run and clears the active status", async () => {
	const store = createMockStore([userMessage("Keep working on the draft.")]);
	const session = createMockSession();
	const coordinator = new LiveRunCoordinator({
		store,
		sessionFactory: async () => session,
		deliverer: async () => true,
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Keep working on the draft.",
	});

	await waitFor(() => session.sendUserMessageCalls.length === 1);
	session.emit({ type: "turn_start" });
	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "running");

	const cancelled = coordinator.cancelActiveRun("telegram");
	expect(cancelled?.status).toBe("running");

	await waitFor(() => session.abortCalls === 1);
	expect(session.clearQueueCalls).toBe(1);
	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});
