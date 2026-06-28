import { expect, test } from "bun:test";
import { LiveRunCoordinator } from "../src/live-run";
import type { ConversationMetadata, Message } from "../src/conversation";
import type { ExecutionResult } from "../src/memory";

function waitFor(
	check: () => boolean,
	timeoutMs = 2_000,
): Promise<void> {
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

function createMockStore(initialMessages: Message[] = []) {
	const conversations = new Map<
		string,
		{
			metadata: ConversationMetadata;
			messages: Message[];
		}
	>();

	const ensureConversation = (id: string) => {
		let conversation = conversations.get(id);
		if (!conversation) {
			conversation = {
				metadata: {},
				messages: [],
			};
			conversations.set(id, conversation);
		}
		return conversation;
	};

	const seed = ensureConversation("telegram");
	seed.messages.push(...initialMessages);

	return {
		get(id: string) {
			const conversation = conversations.get(id);
			if (!conversation) return undefined;
			return { metadata: conversation.metadata };
		},
		create(id: string) {
			return { metadata: ensureConversation(id).metadata };
		},
		getMetadata(conversationId: string) {
			return ensureConversation(conversationId).metadata;
		},
		updateMetadata(
			conversationId: string,
			metadata: Partial<ConversationMetadata>,
		) {
			const conversation = ensureConversation(conversationId);
			conversation.metadata = { ...conversation.metadata, ...metadata };
		},
		getMessagesForAI(conversationId: string) {
			return [...ensureConversation(conversationId).messages];
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
			ensureConversation(conversationId).messages.push({
				role,
				content,
				timestamp: Date.now(),
				source,
				workerType,
				workerStatus,
				files,
			});
		},
	};
}

test("suppresses the duplicate final blast when send_message already spoke", async () => {
	const store = createMockStore([
		{
			role: "user",
			content: "Please summarize the attached notes.",
			timestamp: Date.now() - 1_000,
			source: "telegram",
		},
	]);

	const deliveries: string[] = [];
	let releaseRun: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		releaseRun = resolve;
	});
	const coordinator = new LiveRunCoordinator({
		store,
		executor: async (task) => {
			await started;
			return {
				task,
				result: "Final summary",
				actions: [],
				iterations: 1,
				duration: 25,
				usedSendMessage: true,
			} satisfies ExecutionResult;
		},
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

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "running");
	releaseRun();
	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(deliveries).toHaveLength(0);
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("resumes a blocked run in the same conversation after an answer arrives", async () => {
	const store = createMockStore([
		{
			role: "user",
			content: "Update the report.",
			timestamp: Date.now() - 2_000,
			source: "telegram",
		},
	]);

	const prompts: string[] = [];
	let callCount = 0;
	const deliveries: string[] = [];
	const coordinator = new LiveRunCoordinator({
		store,
		executor: async (task) => {
			callCount += 1;
			prompts.push(task);
			if (callCount === 1) {
				return {
					task,
					result: "Need the target filename.",
					blocked: true,
					question: "Which file should I edit?",
					actions: [],
					iterations: 1,
					duration: 20,
				} satisfies ExecutionResult;
			}

			return {
				task,
				result: "updated file-b.txt",
				actions: [],
				iterations: 1,
				duration: 20,
			} satisfies ExecutionResult;
		},
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

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "blocked");

	store.addMessage(
		"telegram",
		"user",
		"Use file B instead.",
		"telegram",
	);
	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "blocked_answer",
		preview: "Use file B instead.",
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");

	expect(callCount).toBe(2);
	expect(prompts[1]).toContain("Use file B instead.");
	expect(deliveries[0]).toContain("Which file should I edit?");
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});

test("cancels a running live run and clears the active status", async () => {
	const store = createMockStore([
		{
			role: "user",
			content: "Keep working on the draft.",
			timestamp: Date.now() - 1_000,
			source: "telegram",
		},
	]);

	let resolveAbort: (result: ExecutionResult) => void = () => {};
	const coordinator = new LiveRunCoordinator({
		store,
		executor: async (task, _history, abortSignal) =>
			new Promise<ExecutionResult>((resolve) => {
				resolveAbort = resolve;
				abortSignal?.addEventListener("abort", () => {
					resolve({
						task,
						result: "Error: Run cancelled by user",
						actions: [],
						iterations: 0,
						duration: 0,
						incomplete: true,
						usedSendMessage: false,
						error: {
							type: "api_error",
							message: "Run cancelled by user",
							provider: "openrouter",
						},
					});
				});
			}),
		deliverer: async () => true,
	});

	coordinator.requestRun({
		conversationId: "telegram",
		source: "telegram",
		kind: "new_run",
		preview: "Keep working on the draft.",
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "running");
	const cancelled = coordinator.cancelActiveRun("telegram");
	expect(cancelled?.status).toBe("running");

	resolveAbort({
		task: "Keep working on the draft.",
		result: "Error: Run cancelled by user",
		actions: [],
		iterations: 0,
		duration: 0,
		incomplete: true,
		usedSendMessage: false,
		error: {
			type: "api_error",
			message: "Run cancelled by user",
			provider: "openrouter",
		},
	});

	await waitFor(() => coordinator.getStatusSnapshot("telegram").status === "idle");
	expect(coordinator.getStatusSnapshot("telegram").currentRun).toBeNull();
});
