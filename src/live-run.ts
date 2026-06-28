import { Agent, RUN_CANCELLED_MESSAGE } from "./agent.js";
import {
	type ConversationMetadata,
	conversationStore,
	type Message,
	TELEGRAM_CONVERSATION_ID,
} from "./conversation.js";
import type { ExecutionResult } from "./memory.js";
import { sendTelegramMessageToAdmin } from "./telegram-client.js";

export type LiveRunStatus = "idle" | "running" | "blocked";

export type LiveRunSource = "telegram" | "scheduled" | "manual";

export type LiveRunTriggerKind =
	| "new_run"
	| "live_update"
	| "blocked_answer"
	| "scheduled";

export interface LiveRunSummary {
	id?: string;
	source?: LiveRunSource;
	status: LiveRunStatus;
	preview: string;
	question?: string;
	startedAt?: number;
	updatedAt?: number;
}

export interface LiveRunSnapshot {
	conversationId: string;
	status: LiveRunStatus;
	currentRun: LiveRunSummary | null;
	canCancel: boolean;
	rerunRequested: boolean;
}

export interface LiveRunRequest {
	conversationId?: string;
	source: LiveRunSource;
	kind: LiveRunTriggerKind;
	preview?: string;
}

interface LiveRunCoordinatorOptions {
	store?: LiveRunConversationStore;
	executor?: (
		task: string,
		history: Message[],
		abortSignal?: AbortSignal,
	) => Promise<ExecutionResult>;
	deliverer?: (text: string, abortSignal?: AbortSignal) => Promise<boolean>;
	defaultConversationId?: string;
}

interface LiveRunState {
	id: string;
	conversationId: string;
	status: LiveRunStatus;
	source?: LiveRunSource;
	preview: string;
	question?: string;
	startedAt?: number;
	updatedAt?: number;
	rerunRequested: boolean;
	controller: AbortController | null;
}

interface LiveRunConversationStore {
	get(id: string): { metadata?: ConversationMetadata } | undefined;
	create(id: string): { metadata?: ConversationMetadata };
	getMetadata(conversationId: string): ConversationMetadata;
	updateMetadata(
		conversationId: string,
		metadata: Partial<ConversationMetadata>,
	): void;
	getMessagesForAI(conversationId: string): Message[];
	addMessage(
		conversationId: string,
		role: "user" | "assistant" | "worker",
		content: string,
		source?: "web" | "telegram",
		workerType?: "tool" | "bash",
		workerStatus?: "started" | "completed" | "failed",
		files?: Message["files"],
	): void;
}

function summarizePreview(text: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (normalized.length <= 140) return normalized;
	return `${normalized.slice(0, 137).trimEnd()}...`;
}

export function formatLiveRunAge(timestamp: number): string {
	const elapsedMs = Math.max(0, Date.now() - timestamp);
	const elapsedMinutes = Math.floor(elapsedMs / 60_000);
	if (elapsedMinutes < 1) return "less than a minute";
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"}`;
	}
	const hours = Math.floor(elapsedMinutes / 60);
	const minutes = elapsedMinutes % 60;
	return `${hours}h ${minutes}m`;
}

function readActiveRunMetadata(metadata: ConversationMetadata): {
	id?: string;
	source?: LiveRunSource;
	status: LiveRunStatus;
	preview?: string;
	question?: string;
	startedAt?: number;
	updatedAt?: number;
} | null {
	if (metadata.activeRunStatus) {
		return {
			id: metadata.activeRunId,
			source: metadata.activeRunSource,
			status: metadata.activeRunStatus,
			preview: metadata.activeRunPreview,
			question: metadata.activeRunQuestion,
			startedAt: metadata.activeRunStartedAt,
			updatedAt: metadata.activeRunUpdatedAt,
		};
	}

	if (!metadata.activeTaskStatus) {
		return null;
	}

	const legacyStatus = metadata.activeTaskStatus;
	if (legacyStatus !== "running" && legacyStatus !== "blocked") {
		return null;
	}
	const activeStatus: "running" | "blocked" = legacyStatus;

	return {
		id: metadata.activeTaskId ? String(metadata.activeTaskId) : undefined,
		source: "telegram",
		status: activeStatus,
		preview: metadata.activeTaskPreview,
		question: metadata.activeTaskQuestion,
		startedAt: metadata.activeTaskStartedAt,
		updatedAt: metadata.activeTaskUpdatedAt,
	};
}

function getLatestRunPrompt(
	history: Message[],
	fallbackPreview?: string,
): string {
	const latestRelevant = [...history]
		.reverse()
		.find(
			(message) =>
				message.role === "user" ||
				(message.role === "worker" && message.workerStatus !== "failed"),
		);

	if (latestRelevant) {
		const content = latestRelevant.content.trim();
		const prefix =
			latestRelevant.role === "worker"
				? "Scheduled update"
				: "Latest user update";
		return `${prefix}:\n${content}`;
	}

	if (fallbackPreview) {
		return fallbackPreview;
	}

	return "Continue the live conversation and respond to the newest relevant update.";
}

function writeActiveRunMetadata(
	store: LiveRunConversationStore,
	conversationId: string,
	state: LiveRunState,
): void {
	store.updateMetadata(conversationId, {
		activeRunId: state.status === "idle" ? undefined : state.id,
		activeRunSource: state.status === "idle" ? undefined : state.source,
		activeRunStatus: state.status === "idle" ? undefined : state.status,
		activeRunPreview: state.status === "idle" ? undefined : state.preview,
		activeRunQuestion: state.status === "blocked" ? state.question : undefined,
		activeRunStartedAt: state.status === "idle" ? undefined : state.startedAt,
		activeRunUpdatedAt: state.status === "idle" ? undefined : state.updatedAt,
		// Clear legacy task fields so the live-run fields become authoritative.
		activeTaskId: undefined,
		activeTaskSourceKey: undefined,
		activeTaskStatus: undefined,
		activeTaskPreview: undefined,
		activeTaskQuestion: undefined,
		activeTaskStartedAt: undefined,
		activeTaskUpdatedAt: undefined,
	});
}

export function summarizeLiveRun(
	state: Pick<
		LiveRunState,
		| "id"
		| "source"
		| "status"
		| "preview"
		| "question"
		| "startedAt"
		| "updatedAt"
	>,
): LiveRunSummary {
	return {
		id: state.id,
		source: state.source,
		status: state.status,
		preview: summarizePreview(state.preview),
		question: state.question,
		startedAt: state.startedAt,
		updatedAt: state.updatedAt,
	};
}

export class LiveRunCoordinator {
	private readonly store: LiveRunConversationStore;
	private readonly executor: NonNullable<LiveRunCoordinatorOptions["executor"]>;
	private readonly deliverer: NonNullable<
		LiveRunCoordinatorOptions["deliverer"]
	>;
	private readonly defaultConversationId: string;
	private readonly states = new Map<string, LiveRunState>();
	private readonly running = new Set<string>();
	private started = false;

	constructor(options: LiveRunCoordinatorOptions = {}) {
		this.store = options.store ?? conversationStore;
		this.executor =
			options.executor ||
			(async (task, history, abortSignal) =>
				new Agent().execute(task, history, abortSignal));
		this.deliverer =
			options.deliverer ||
			(async (text, abortSignal) =>
				(await sendTelegramMessageToAdmin(text, [], abortSignal)).ok);
		this.defaultConversationId =
			options.defaultConversationId || TELEGRAM_CONVERSATION_ID;
	}

	start(conversationId = this.defaultConversationId): void {
		if (this.started) return;
		this.started = true;
		this.ensureState(conversationId);
	}

	async stop(): Promise<void> {
		this.started = false;
		for (const state of this.states.values()) {
			state.controller?.abort(new Error(RUN_CANCELLED_MESSAGE));
		}
		while (this.running.size > 0) {
			await Bun.sleep(5);
		}
	}

	getStatusSnapshot(
		conversationId = this.defaultConversationId,
	): LiveRunSnapshot {
		const state = this.ensureState(conversationId);
		const currentRun =
			state.status === "idle"
				? null
				: summarizeLiveRun({
						id: state.id,
						source: state.source,
						status: state.status,
						preview: state.preview,
						question: state.question,
						startedAt: state.startedAt,
						updatedAt: state.updatedAt,
					});

		return {
			conversationId,
			status: state.status,
			currentRun,
			canCancel: state.status !== "idle",
			rerunRequested: state.rerunRequested,
		};
	}

	cancelActiveRun(
		conversationId = this.defaultConversationId,
	): LiveRunSummary | null {
		const state = this.ensureState(conversationId);
		if (state.status === "idle") {
			return null;
		}

		const summary = summarizeLiveRun({
			id: state.id,
			source: state.source,
			status: state.status,
			preview: state.preview,
			question: state.question,
			startedAt: state.startedAt,
			updatedAt: state.updatedAt,
		});

		state.rerunRequested = false;
		if (state.status === "blocked") {
			state.controller?.abort(new Error(RUN_CANCELLED_MESSAGE));
			this.resetState(conversationId, state);
			return summary;
		}

		state.controller?.abort(new Error(RUN_CANCELLED_MESSAGE));
		return summary;
	}

	requestRun(request: LiveRunRequest): void {
		const conversationId = request.conversationId || this.defaultConversationId;
		const state = this.ensureState(conversationId);
		const now = Date.now();

		state.source = request.source;
		state.updatedAt = now;

		if (state.status === "running") {
			state.preview = request.preview || state.preview || "Live run update";
			state.rerunRequested = true;
			writeActiveRunMetadata(this.store, conversationId, state);
			return;
		}

		if (state.status === "blocked") {
			if (this.running.has(conversationId)) {
				state.rerunRequested = true;
				state.updatedAt = now;
				writeActiveRunMetadata(this.store, conversationId, state);
				return;
			}
			this.resetState(conversationId, state);
			state.source = request.source;
			state.preview = request.preview || state.preview || "Live run update";
			state.updatedAt = now;
		}

		this.startRunLoop(conversationId, request.kind);
	}

	private ensureState(conversationId: string): LiveRunState {
		const existing = this.states.get(conversationId);
		if (existing) return existing;

		const conversation =
			this.store.get(conversationId) || this.store.create(conversationId);
		const metadata = conversation.metadata || {};
		const activeRun = readActiveRunMetadata(metadata);
		const restored: LiveRunState = activeRun
			? {
					id: activeRun.id || crypto.randomUUID(),
					conversationId,
					status: activeRun.status,
					source: activeRun.source,
					preview: activeRun.preview || "",
					question: activeRun.question,
					startedAt: activeRun.startedAt,
					updatedAt: activeRun.updatedAt,
					rerunRequested: false,
					controller: null,
				}
			: {
					id: crypto.randomUUID(),
					conversationId,
					status: "idle",
					preview: "",
					rerunRequested: false,
					controller: null,
				};

		if (activeRun?.status === "running") {
			this.store.updateMetadata(conversationId, {
				activeRunId: undefined,
				activeRunSource: undefined,
				activeRunStatus: undefined,
				activeRunPreview: undefined,
				activeRunQuestion: undefined,
				activeRunStartedAt: undefined,
				activeRunUpdatedAt: undefined,
			});
			restored.status = "idle";
			restored.startedAt = undefined;
			restored.updatedAt = undefined;
			restored.question = undefined;
			restored.source = undefined;
		}

		this.states.set(conversationId, restored);
		if (restored.status !== "idle") {
			writeActiveRunMetadata(this.store, conversationId, restored);
		}

		return restored;
	}

	private resetState(conversationId: string, state: LiveRunState): void {
		state.status = "idle";
		state.source = undefined;
		state.preview = "";
		state.question = undefined;
		state.startedAt = undefined;
		state.updatedAt = Date.now();
		state.controller = null;
		state.rerunRequested = false;
		state.id = crypto.randomUUID();
		writeActiveRunMetadata(this.store, conversationId, state);
	}

	private startRunLoop(
		conversationId: string,
		triggerKind: LiveRunTriggerKind,
	): void {
		if (this.running.has(conversationId)) return;
		this.running.add(conversationId);
		void this.runConversation(conversationId, triggerKind).finally(() => {
			this.running.delete(conversationId);
		});
	}

	private async runConversation(
		conversationId: string,
		_triggerKind: LiveRunTriggerKind,
	): Promise<void> {
		const state = this.ensureState(conversationId);
		state.rerunRequested = false;

		try {
			while (true) {
				const task = getLatestRunPrompt(
					this.store.getMessagesForAI(conversationId),
					state.preview,
				);
				const startedAt = Date.now();
				const controller = new AbortController();
				state.id = crypto.randomUUID();
				state.status = "running";
				state.startedAt = startedAt;
				state.updatedAt = startedAt;
				state.question = undefined;
				state.controller = controller;
				state.preview = summarizePreview(task);
				writeActiveRunMetadata(this.store, conversationId, state);

				const history = this.store.getMessagesForAI(conversationId);
				const result = await this.executor(task, history, controller.signal);
				const rerunRequested = state.rerunRequested;
				state.updatedAt = Date.now();

				const cancelled =
					result.error?.message === RUN_CANCELLED_MESSAGE ||
					result.result === `Error: ${RUN_CANCELLED_MESSAGE}`;

				if (cancelled) {
					state.controller = null;
					this.resetState(conversationId, state);
					if (rerunRequested) {
						state.rerunRequested = false;
						continue;
					}
					return;
				}

				if (rerunRequested) {
					state.controller = null;
					state.rerunRequested = false;
					continue;
				}

				if (result.blocked) {
					state.status = "blocked";
					state.question =
						result.question || "I need more information to continue.";
					state.preview = summarizePreview(
						result.question || result.result || task,
					);
					state.updatedAt = Date.now();
					writeActiveRunMetadata(this.store, conversationId, state);
					if (!state.rerunRequested && !result.usedSendMessage) {
						await this.deliver(
							state.question || "I need more information to continue.",
							conversationId,
							controller.signal,
						);
					}
					state.controller = null;
					if (state.rerunRequested) {
						state.rerunRequested = false;
						continue;
					}
					return;
				}

				if (result.incomplete || result.error) {
					if (!state.rerunRequested && !result.usedSendMessage) {
						await this.deliver(
							result.result || result.error?.message || "Run did not complete",
							conversationId,
							controller.signal,
						);
					}
					if (state.rerunRequested) {
						state.controller = null;
						state.rerunRequested = false;
						continue;
					}
					state.controller = null;
					this.resetState(conversationId, state);
					return;
				}

				if (!state.rerunRequested && !result.usedSendMessage) {
					await this.deliver(
						result.result || "Run completed",
						conversationId,
						controller.signal,
					);
				}

				if (state.rerunRequested) {
					state.controller = null;
					state.rerunRequested = false;
					continue;
				}
				state.controller = null;
				this.resetState(conversationId, state);
				return;
			}
		} finally {
			state.controller = null;
			state.updatedAt = Date.now();
			if (state.status !== "blocked") {
				writeActiveRunMetadata(this.store, conversationId, state);
			}
		}
	}

	private async deliver(
		text: string,
		conversationId: string,
		abortSignal?: AbortSignal,
	): Promise<void> {
		const delivered = await this.deliverer(text, abortSignal);
		if (delivered) {
			this.store.addMessage(conversationId, "assistant", text, "telegram");
		}
	}
}

let liveRunCoordinatorInstance: LiveRunCoordinator | null = null;

export function getLiveRunCoordinator(): LiveRunCoordinator {
	if (!liveRunCoordinatorInstance) {
		liveRunCoordinatorInstance = new LiveRunCoordinator();
	}
	return liveRunCoordinatorInstance;
}

export function startLiveRunCoordinator(): void {
	getLiveRunCoordinator().start();
}

export async function stopLiveRunCoordinator(): Promise<void> {
	if (liveRunCoordinatorInstance) {
		await liveRunCoordinatorInstance.stop();
	}
}
