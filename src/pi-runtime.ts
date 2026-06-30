import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { getModel as getBuiltinModel } from "@earendil-works/pi-ai/compat";
import {
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	type ConversationMetadata,
	conversationStore,
	type Message,
	TELEGRAM_CONVERSATION_ID,
} from "./conversation.js";
import { getEnvVar } from "./env.js";
import { clearWorkspaceContextCache, loadWorkspaceContext } from "./prompts.js";
import {
	buildWorkspaceAttachment,
	sendTelegramMessageToAdmin,
} from "./telegram-client.js";
import { buildThreadState } from "./thread-utils.js";
import { workspacePath } from "./workspace.js";

export type LiveRunStatus = "idle" | "running" | "blocked";

export type LiveRunSource = "telegram" | "scheduled" | "manual";

export type LiveRunTriggerKind =
	| "new_run"
	| "live_update"
	| "blocked_answer"
	| "scheduled"
	| "steer";

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
	sessionFactory?: (input: {
		conversationId: string;
		state: LiveRunState;
		deliverer: TelegramDeliverer;
		store: LiveRunConversationStore;
	}) => Promise<LiveConversationSession>;
	deliverer?: TelegramDeliverer;
	defaultConversationId?: string;
}

export interface LiveConversationSession {
	sessionId: string;
	sessionFile?: string;
	isStreaming: boolean;
	pendingMessageCount?: number;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	sendUserMessage(
		content: string,
		options?: {
			deliverAs?: "steer" | "followUp";
		},
	): Promise<void>;
	steer(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): Promise<void>;
	clearQueue(): {
		steering: string[];
		followUp: string[];
	};
	getLastAssistantText(): string | undefined;
	dispose(): void;
}

type TelegramDeliverer = (
	text: string,
	files?: string[],
	abortSignal?: AbortSignal,
) => Promise<boolean>;

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
	usedSendMessage: boolean;
	turnResponseDelivered: boolean;
	session: LiveConversationSession | null;
	sessionLoading: Promise<LiveConversationSession> | null;
	unsubscribe: (() => void) | null;
	sessionFile?: string;
}

interface LiveRunConversationStore {
	get(
		id: string,
	): { metadata?: ConversationMetadata; lastActivity: number } | undefined;
	create(id: string): { metadata?: ConversationMetadata };
	getMetadata(conversationId: string): ConversationMetadata;
	getRecentMessages(conversationId: string, limit?: number): Message[];
	getMessagesSince(conversationId: string, sinceTimestamp: number): Message[];
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

const PI_WORKSPACE = workspacePath();
const PI_AGENT_DIR = workspacePath(".pi", "agent");
const PI_SESSION_DIR = workspacePath(".pi", "sessions");
export const LIVE_BUILTIN_TOOL_NAMES = [
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
] as const;
export const LIVE_CUSTOM_TOOL_NAMES = [
	"refresh_thread",
	"send_message",
	"ask_user",
] as const;
export const LIVE_SESSION_TOOL_NAMES = [
	...LIVE_BUILTIN_TOOL_NAMES,
	...LIVE_CUSTOM_TOOL_NAMES,
] as const;

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
			id: metadata.activeRunId || metadata.piSessionId,
			source: metadata.activeRunSource,
			status: metadata.activeRunStatus,
			preview: metadata.activeRunPreview,
			question: metadata.activeRunQuestion,
			startedAt: metadata.activeRunStartedAt,
			updatedAt: metadata.activeRunUpdatedAt,
		};
	}

	return null;
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
		piSessionFile: state.sessionFile,
		piSessionId: state.id,
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

function isWorkspaceContextFile(path: string): boolean {
	const file = basename(path);
	return (
		file === "BOOTSTRAP.md" ||
		file === "IDENTITY.md" ||
		file === "SOUL.md" ||
		file === "USER.md"
	);
}

function shouldClearWorkspaceCacheFromToolResult(event: {
	toolName: string;
	input: Record<string, unknown>;
}): boolean {
	if (event.toolName !== "write" && event.toolName !== "edit") {
		return false;
	}
	const path = event.input.path;
	return typeof path === "string" && isWorkspaceContextFile(path);
}

function toAssistantTextContent(
	text: string,
): Array<{ type: "text"; text: string }> {
	return text.trim().length > 0 ? [{ type: "text", text }] : [];
}

function normalizeAssistantText(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function extractTextFromMessage(message: unknown): string | undefined {
	if (!message || typeof message !== "object") {
		return undefined;
	}

	const maybeMessage = message as {
		content?: unknown;
		text?: unknown;
	};

	if (typeof maybeMessage.text === "string") {
		const normalized = normalizeAssistantText(maybeMessage.text);
		return normalized || undefined;
	}

	if (typeof maybeMessage.content === "string") {
		const normalized = normalizeAssistantText(maybeMessage.content);
		return normalized || undefined;
	}

	if (Array.isArray(maybeMessage.content)) {
		const text = maybeMessage.content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part && typeof part === "object" && "text" in part) {
					const candidate = (part as { text?: unknown }).text;
					return typeof candidate === "string" ? candidate : "";
				}
				return "";
			})
			.join(" ");
		const normalized = normalizeAssistantText(text);
		return normalized || undefined;
	}

	return undefined;
}

function extractAssistantFailureText(message: unknown): string | undefined {
	const text = extractTextFromMessage(message);
	if (text) {
		return text;
	}

	if (!message || typeof message !== "object") {
		return undefined;
	}

	const maybeMessage = message as {
		errorMessage?: unknown;
		stopReason?: unknown;
	};
	const errorMessage =
		typeof maybeMessage.errorMessage === "string"
			? maybeMessage.errorMessage.trim()
			: "";
	const stopReason =
		typeof maybeMessage.stopReason === "string"
			? maybeMessage.stopReason
			: undefined;

	if (!errorMessage || stopReason === "aborted") {
		return undefined;
	}

	return `Error: ${errorMessage}`;
}

async function deliverFinalAssistantResponse(
	conversationId: string,
	state: LiveRunState,
	deliverer: TelegramDeliverer,
	store: LiveRunConversationStore,
	responseText: string,
): Promise<boolean> {
	if (state.turnResponseDelivered) {
		return false;
	}

	state.turnResponseDelivered = true;

	const delivered = await deliverer(responseText, []);
	if (delivered) {
		store.addMessage(conversationId, "assistant", responseText, "telegram");
	}

	return delivered;
}

export function normalizeLegacySessionAssistantContent(
	sessionManager: SessionManager,
): boolean {
	const sessionFile = sessionManager.getSessionFile();
	const entries = sessionManager.getEntries();
	let migrated = false;

	for (const entry of entries) {
		if (entry.type !== "message") {
			continue;
		}

		const message = entry.message as {
			role?: string;
			content?: unknown;
		};

		if (message.role !== "assistant" || typeof message.content !== "string") {
			continue;
		}

		message.content = toAssistantTextContent(message.content);
		migrated = true;
	}

	if (!migrated) {
		return false;
	}

	if (sessionManager.isPersisted() && sessionFile) {
		const header = sessionManager.getHeader();
		if (header) {
			const serialized = [header, ...entries]
				.map((entry) => JSON.stringify(entry))
				.join("\n");
			writeFileSync(sessionFile, `${serialized}\n`);
		}
	}

	return true;
}

function seedConversationHistory(
	sessionManager: SessionManager,
	messages: Message[],
): void {
	if (sessionManager.getEntries().length > 0) {
		return;
	}

	for (const message of messages) {
		if (message.role === "worker") {
			sessionManager.appendMessage({
				role: "assistant",
				content: toAssistantTextContent(
					`[Worker ${message.workerType || "task"}${message.workerStatus ? `:${message.workerStatus}` : ""}]\n${message.content}`,
				),
			} as unknown as Parameters<SessionManager["appendMessage"]>[0]);
			continue;
		}

		if (message.role === "assistant") {
			sessionManager.appendMessage({
				role: "assistant",
				content: toAssistantTextContent(message.content),
			} as unknown as Parameters<SessionManager["appendMessage"]>[0]);
			continue;
		}

		sessionManager.appendMessage({
			role: message.role,
			content: message.content,
		} as unknown as Parameters<SessionManager["appendMessage"]>[0]);
	}
}

function resolveDefaultModelSelection(): {
	modelId: string;
} | null {
	const raw = getEnvVar("AI_MODEL")?.trim();
	if (!raw) {
		return null;
	}

	return {
		modelId: raw,
	};
}

function buildSessionMessageContent(text: string): string {
	return text.trim();
}

function createPiCustomTools(
	conversationId: string,
	state: LiveRunState,
	store: LiveRunConversationStore,
	deliverer: TelegramDeliverer,
): Array<ReturnType<typeof defineTool>> {
	const refreshThreadTool = defineTool({
		name: "refresh_thread",
		label: "Refresh Thread",
		description:
			"Read the current live conversation state and recent messages before continuing.",
		promptSnippet: "Refresh the live thread state",
		promptGuidelines: [
			"Use refresh_thread when a new user message arrived while you were working or when you need the latest live run state.",
		],
		parameters: Type.Object({
			conversationId: Type.Optional(Type.String()),
			sinceTimestamp: Type.Optional(Type.Number()),
			limit: Type.Optional(Type.Number()),
		}),
		execute: async (_toolCallId, params) => {
			const stateSnapshot = buildThreadState(
				(params.conversationId as string | undefined) || conversationId,
				params.sinceTimestamp as number | undefined,
				(typeof params.limit === "number" ? params.limit : undefined) || 8,
				store,
			);

			return {
				content: [
					{
						type: "text",
						text: stateSnapshot.summary,
					},
				],
				details: stateSnapshot,
			};
		},
	});

	const buildSendMessageTool = () =>
		defineTool({
			name: "send_message",
			label: "Send Message",
			description:
				"Send a proactive Telegram update to the user while the live run is still working. This is the explicit way to speak to the user during a run.",
			promptSnippet: "Send a proactive update to the user",
			promptGuidelines: [
				"You can use send_message multiple times during the same run.",
				"Include workspace file paths in files when the user should see an image, screenshot, chart, or file.",
				"Keep the message concise and mobile-friendly.",
			],
			parameters: Type.Object({
				message: Type.String({
					description: "The message to send to the user",
				}),
				files: Type.Optional(
					Type.Array(Type.String(), {
						description: "Optional workspace file paths to attach",
					}),
				),
			}),
			execute: async (_toolCallId, params, signal) => {
				const message = buildSessionMessageContent(params.message);
				if (!message) {
					throw new Error("message parameter is required");
				}

				const fileList = Array.isArray(params.files)
					? params.files.filter(
							(value): value is string => typeof value === "string",
						)
					: [];
				const attachments = fileList
					.map((filePath) => buildWorkspaceAttachment(filePath))
					.filter((attachment): attachment is NonNullable<typeof attachment> =>
						Boolean(attachment),
					);
				const warnings = fileList
					.filter((filePath) => !buildWorkspaceAttachment(filePath))
					.map((filePath) => `Access denied or missing file: ${filePath}`);

				const result = await deliverer(
					message,
					attachments.map((attachment) => attachment.path),
					signal,
				);

				if (result) {
					store.addMessage(
						conversationId,
						"assistant",
						message,
						"telegram",
						undefined,
						undefined,
						attachments.length > 0 ? attachments : undefined,
					);
				}

				return {
					content: [
						{
							type: "text",
							text: result
								? "Delivered the update to Telegram."
								: "Failed to deliver the Telegram update.",
						},
					],
					details: {
						delivered: result,
						filesAttached: attachments.map((attachment) => attachment.filename),
						warnings,
					},
				};
			},
		});

	const askUserTool = defineTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Pause the run and ask the Telegram user one clear question when you cannot continue. This blocks until the answer arrives.",
		promptSnippet: "Pause and ask one clear question",
		promptGuidelines: [
			"Use ask_user only when the run cannot continue without exactly one missing answer.",
			"Ask one specific question and stop after calling ask_user.",
		],
		parameters: Type.Object({
			question: Type.String({
				description: "The single question to ask the user",
			}),
		}),
		execute: async (_toolCallId, params, signal) => {
			const question = buildSessionMessageContent(params.question);
			if (!question) {
				throw new Error("question parameter is required");
			}

			state.status = "blocked";
			state.question = question;
			state.updatedAt = Date.now();
			writeActiveRunMetadata(store, conversationId, state);

			const delivered = await deliverer(question, [], signal);
			if (delivered) {
				store.addMessage(conversationId, "assistant", question, "telegram");
			}

			return {
				content: [
					{
						type: "text",
						text: delivered
							? "I asked the user and am waiting for the answer."
							: "I could not deliver the blocking question.",
					},
				],
				details: {
					blocked: true,
					question,
					delivered,
				},
				terminate: true,
			};
		},
	});

	return [refreshThreadTool, buildSendMessageTool(), askUserTool];
}

function createSessionContextSnapshot(state: LiveRunState): LiveRunSummary {
	return summarizeLiveRun({
		id: state.id,
		source: state.source,
		status: state.status,
		preview: state.preview,
		question: state.question,
		startedAt: state.startedAt,
		updatedAt: state.updatedAt,
	});
}

export class LiveRunCoordinator {
	private readonly store: LiveRunConversationStore;
	private readonly sessionFactory: NonNullable<
		LiveRunCoordinatorOptions["sessionFactory"]
	>;
	private readonly deliverer: TelegramDeliverer;
	private readonly defaultConversationId: string;
	private readonly states = new Map<string, LiveRunState>();
	private readonly pendingToolInputs = new Map<
		string,
		{ toolName: string; input: Record<string, unknown> }
	>();
	private started = false;

	constructor(options: LiveRunCoordinatorOptions = {}) {
		this.store = options.store || conversationStore;
		this.deliverer =
			options.deliverer ||
			(async (text, files = [], abortSignal) => {
				try {
					const result = await sendTelegramMessageToAdmin(
						text,
						files,
						abortSignal,
					);
					return result.messageDelivered;
				} catch (err) {
					console.warn("[LiveRun] Failed to deliver Telegram message:", err);
					return false;
				}
			});
		this.sessionFactory =
			options.sessionFactory || this.createDefaultSession.bind(this);
		this.defaultConversationId =
			options.defaultConversationId || TELEGRAM_CONVERSATION_ID;
	}

	start(conversationId = this.defaultConversationId): void {
		if (this.started) return;
		this.started = true;
		const state = this.ensureState(conversationId);
		void this.prepareSession(conversationId, state).catch((err) => {
			console.warn("[LiveRun] Failed to warm Pi session:", err);
		});
	}

	async stop(): Promise<void> {
		this.started = false;
		for (const state of this.states.values()) {
			if (state.sessionLoading) {
				try {
					await state.sessionLoading;
				} catch {
					// Ignore warmup errors while shutting down.
				}
			}
			state.session?.clearQueue();
			await state.session?.abort().catch(() => undefined);
			state.unsubscribe?.();
			state.session?.dispose();
			state.session = null;
			state.unsubscribe = null;
		}
	}

	getStatusSnapshot(
		conversationId = this.defaultConversationId,
	): LiveRunSnapshot {
		const state = this.ensureState(conversationId);
		return {
			conversationId,
			status: state.status,
			currentRun:
				state.status === "idle" && !state.question
					? null
					: createSessionContextSnapshot(state),
			canCancel:
				state.status !== "idle" || !!state.session?.pendingMessageCount,
			rerunRequested: state.rerunRequested,
		};
	}

	cancelActiveRun(
		conversationId = this.defaultConversationId,
	): LiveRunSummary | null {
		const state = this.ensureState(conversationId);
		if (state.status === "idle" && !state.session?.pendingMessageCount) {
			return null;
		}

		const summary = createSessionContextSnapshot(state);
		state.rerunRequested = false;
		state.status = "idle";
		state.question = undefined;
		state.startedAt = undefined;
		state.updatedAt = Date.now();
		writeActiveRunMetadata(this.store, conversationId, state);

		if (state.session) {
			state.session.clearQueue();
			void state.session.abort().catch((err) => {
				console.warn("[LiveRun] Failed to abort Pi session:", err);
			});
		}

		return summary;
	}

	requestRun(request: LiveRunRequest): void {
		const conversationId = request.conversationId || this.defaultConversationId;
		const state = this.ensureState(conversationId);
		const now = Date.now();
		const preview = summarizePreview(
			request.preview || state.preview || "Live run update",
		);

		console.log(
			`[LiveRun] Request received (${request.kind}/${request.source}): ${preview}`,
		);

		state.source = request.source;
		state.preview = preview;
		state.updatedAt = now;
		state.usedSendMessage = false;
		state.turnResponseDelivered = false;

		void this.routeRequest(conversationId, state, request).catch((err) => {
			console.error("[LiveRun] Failed to route live request:", err);
		});
	}

	private ensureState(conversationId: string): LiveRunState {
		const existing = this.states.get(conversationId);
		if (existing) {
			return existing;
		}

		const metadata = this.store.getMetadata(conversationId);
		const activeRun = readActiveRunMetadata(metadata);
		const state: LiveRunState = {
			id:
				metadata.piSessionId ||
				activeRun?.id ||
				`${conversationId}-${Date.now()}`,
			conversationId,
			status: activeRun?.status === "blocked" ? "blocked" : "idle",
			source: activeRun?.source,
			preview: activeRun?.preview || "Live run update",
			question: activeRun?.question,
			startedAt:
				activeRun?.status === "blocked" ? activeRun.startedAt : undefined,
			updatedAt: activeRun?.updatedAt || Date.now(),
			rerunRequested: false,
			usedSendMessage: false,
			turnResponseDelivered: false,
			session: null,
			sessionLoading: null,
			unsubscribe: null,
			sessionFile: metadata.piSessionFile,
		};

		if (activeRun?.status === "running") {
			// A process restart while running clears the live state back to idle.
			this.store.updateMetadata(conversationId, {
				activeRunId: undefined,
				activeRunSource: undefined,
				activeRunStatus: undefined,
				activeRunPreview: undefined,
				activeRunQuestion: undefined,
				activeRunStartedAt: undefined,
				activeRunUpdatedAt: undefined,
			});
			state.status = "idle";
			state.question = undefined;
		}

		this.states.set(conversationId, state);
		writeActiveRunMetadata(this.store, conversationId, state);
		return state;
	}

	private async prepareSession(
		conversationId: string,
		state: LiveRunState,
	): Promise<LiveConversationSession> {
		if (state.session) {
			return state.session;
		}

		if (state.sessionLoading) {
			return state.sessionLoading;
		}

		state.sessionLoading = this.sessionFactory({
			conversationId,
			state,
			deliverer: this.deliverer,
			store: this.store,
		})
			.then((session) => {
				state.session = session;
				state.sessionFile = session.sessionFile;
				state.id = session.sessionId || state.id;
				console.log(
					`[LiveRun] Pi session ready: ${session.sessionId}${session.sessionFile ? ` (${session.sessionFile})` : ""}`,
				);
				writeActiveRunMetadata(this.store, conversationId, state);
				state.unsubscribe = session.subscribe((event) => {
					void this.handleSessionEvent(
						conversationId,
						state,
						session,
						event,
					).catch((err) => {
						console.error("[LiveRun] Session event handler failed:", err);
					});
				});
				return session;
			})
			.finally(() => {
				state.sessionLoading = null;
			});

		return state.sessionLoading;
	}

	private async routeRequest(
		conversationId: string,
		state: LiveRunState,
		request: LiveRunRequest,
	): Promise<void> {
		const session = await this.prepareSession(conversationId, state);
		const busy =
			session.isStreaming ||
			Boolean(session.pendingMessageCount && session.pendingMessageCount > 0);
		const text = buildSessionMessageContent(
			request.preview || "Live run update",
		);
		console.log(
			`[LiveRun] Routing ${request.kind} to Pi (${busy ? "busy" : "idle"}): ${text}`,
		);

		if (request.kind === "steer") {
			if (busy) {
				state.rerunRequested = true;
				writeActiveRunMetadata(this.store, conversationId, state);
				await session.steer(text);
				return;
			}

			state.status = "running";
			state.question = undefined;
			state.startedAt ??= Date.now();
			state.updatedAt = Date.now();
			writeActiveRunMetadata(this.store, conversationId, state);
			await session.sendUserMessage(text);
			console.log("[LiveRun] User message accepted by Pi");
			return;
		}

		if (request.kind === "blocked_answer" || state.status === "blocked") {
			state.status = "running";
			state.question = undefined;
			state.startedAt ??= Date.now();
			state.updatedAt = Date.now();
			writeActiveRunMetadata(this.store, conversationId, state);
			await session.sendUserMessage(text);
			console.log("[LiveRun] User message accepted by Pi");
			return;
		}

		if (request.kind === "scheduled") {
			if (busy) {
				state.rerunRequested = true;
				writeActiveRunMetadata(this.store, conversationId, state);
				await session.followUp(text);
				return;
			}

			await session.sendUserMessage(text);
			console.log("[LiveRun] User message accepted by Pi");
			return;
		}

		if (busy) {
			state.rerunRequested = true;
			writeActiveRunMetadata(this.store, conversationId, state);
			await session.steer(text);
			return;
		}

		await session.sendUserMessage(text);
		console.log("[LiveRun] User message accepted by Pi");
	}

	private async handleSessionEvent(
		conversationId: string,
		state: LiveRunState,
		session: LiveConversationSession,
		event: AgentSessionEvent,
	): Promise<void> {
		switch (event.type) {
			case "turn_start": {
				state.status = state.status === "blocked" ? "blocked" : "running";
				const now = Date.now();
				state.startedAt ??= now;
				state.updatedAt = now;
				state.usedSendMessage = false;
				state.turnResponseDelivered = false;
				writeActiveRunMetadata(this.store, conversationId, state);
				break;
			}
			case "queue_update": {
				state.rerunRequested =
					event.steering.length > 0 || event.followUp.length > 0;
				state.updatedAt = Date.now();
				writeActiveRunMetadata(this.store, conversationId, state);
				break;
			}
			case "tool_execution_start": {
				this.pendingToolInputs.set(event.toolCallId, {
					toolName: event.toolName,
					input:
						event.args && typeof event.args === "object"
							? (event.args as Record<string, unknown>)
							: {},
				});
				break;
			}
			case "tool_execution_end": {
				const pendingTool = this.pendingToolInputs.get(event.toolCallId);
				if (pendingTool && !event.isError) {
					const result = event.result as
						| {
								details?: {
									delivered?: boolean;
									messageDelivered?: boolean;
									blocked?: boolean;
									question?: string;
								};
								delivered?: boolean;
								messageDelivered?: boolean;
								blocked?: boolean;
								question?: string;
						  }
						| undefined;

					if (pendingTool.toolName === "ask_user") {
						const question =
							result?.question || result?.details?.question || undefined;
						if (question) {
							state.status = "blocked";
							state.question = question;
							state.updatedAt = Date.now();
							writeActiveRunMetadata(this.store, conversationId, state);
						}
					}

					if (pendingTool.toolName === "send_message") {
						const delivered =
							result?.delivered ??
							result?.messageDelivered ??
							result?.details?.delivered ??
							result?.details?.messageDelivered ??
							false;
						if (delivered) {
							state.usedSendMessage = true;
						}
					}

					if (
						(pendingTool.toolName === "write" ||
							pendingTool.toolName === "edit") &&
						shouldClearWorkspaceCacheFromToolResult({
							toolName: pendingTool.toolName,
							input: pendingTool.input,
						})
					) {
						clearWorkspaceContextCache();
					}
				}
				this.pendingToolInputs.delete(event.toolCallId);
				break;
			}
			case "turn_end": {
				await this.handleTurnEnd(conversationId, state, session, event);
				break;
			}
			case "agent_end": {
				await this.handleAgentEnd(conversationId, state, session, event);
				break;
			}
			default:
				break;
		}
	}

	private async handleTurnEnd(
		conversationId: string,
		state: LiveRunState,
		session: LiveConversationSession,
		event: Extract<AgentSessionEvent, { type: "turn_end" }>,
	): Promise<void> {
		const hasPendingMessages =
			Boolean(session.pendingMessageCount && session.pendingMessageCount > 0) ||
			state.rerunRequested;
		const assistantText =
			extractTextFromMessage(event.message) || session.getLastAssistantText();
		const assistantFailureText = extractAssistantFailureText(event.message);
		if (
			state.status !== "blocked" &&
			!state.usedSendMessage &&
			!hasPendingMessages &&
			(assistantText || assistantFailureText)
		) {
			const responseText = assistantText || assistantFailureText || "";
			if (assistantFailureText && !assistantText) {
				console.warn(
					`[LiveRun] Assistant turn ended with error: ${assistantFailureText}`,
				);
			}
			await deliverFinalAssistantResponse(
				conversationId,
				state,
				this.deliverer,
				this.store,
				responseText,
			);
		}

		state.usedSendMessage = false;
		state.updatedAt = Date.now();

		if (state.status !== "blocked" && !hasPendingMessages) {
			state.status = "idle";
			state.question = undefined;
			state.startedAt = undefined;
			state.rerunRequested = false;
		}

		writeActiveRunMetadata(this.store, conversationId, state);
	}

	private async handleAgentEnd(
		conversationId: string,
		state: LiveRunState,
		session: LiveConversationSession,
		event: Extract<AgentSessionEvent, { type: "agent_end" }>,
	): Promise<void> {
		const hasPendingMessages =
			Boolean(session.pendingMessageCount && session.pendingMessageCount > 0) ||
			state.rerunRequested;
		if (
			state.status !== "blocked" &&
			!state.usedSendMessage &&
			!state.turnResponseDelivered &&
			!hasPendingMessages
		) {
			const lastAssistant = [...event.messages]
				.reverse()
				.find((message) => message.role === "assistant");
			const assistantText =
				extractTextFromMessage(lastAssistant) || session.getLastAssistantText();
			const assistantFailureText = extractAssistantFailureText(lastAssistant);

			if (assistantText || assistantFailureText) {
				const responseText = assistantText || assistantFailureText || "";
				if (assistantFailureText && !assistantText) {
					console.warn(
						`[LiveRun] Agent ended with error: ${assistantFailureText}`,
					);
				}
				await deliverFinalAssistantResponse(
					conversationId,
					state,
					this.deliverer,
					this.store,
					responseText,
				);
			}
		}

		state.usedSendMessage = false;
		state.updatedAt = Date.now();

		if (state.status !== "blocked" && !hasPendingMessages) {
			state.status = "idle";
			state.question = undefined;
			state.startedAt = undefined;
			state.rerunRequested = false;
		}

		writeActiveRunMetadata(this.store, conversationId, state);
	}

	private async createDefaultSession({
		conversationId,
		state,
		store,
	}: {
		conversationId: string;
		state: LiveRunState;
		deliverer: TelegramDeliverer;
		store: LiveRunConversationStore;
	}): Promise<LiveConversationSession> {
		const settingsManager = SettingsManager.create(PI_WORKSPACE, PI_AGENT_DIR);
		const modelSelection = resolveDefaultModelSelection();
		const selectedModel = modelSelection
			? getBuiltinModel(
					"openrouter",
					modelSelection.modelId as Parameters<typeof getBuiltinModel>[1],
				)
			: undefined;
		if (selectedModel) {
			settingsManager.applyOverrides({
				defaultProvider: selectedModel.provider,
				defaultModel: selectedModel.id,
			});
		} else if (modelSelection) {
			console.warn(
				`[LiveRun] Unknown OpenRouter model in AI_MODEL: ${modelSelection.modelId}`,
			);
			settingsManager.applyOverrides({
				defaultProvider: "openrouter",
				defaultModel: modelSelection.modelId,
			});
		}

		const resourceLoader = new DefaultResourceLoader({
			cwd: PI_WORKSPACE,
			agentDir: PI_AGENT_DIR,
			settingsManager,
			appendSystemPrompt: [await loadWorkspaceContext()],
		});
		await resourceLoader.reload();

		const sessionManager =
			state.sessionFile && existsSync(state.sessionFile)
				? SessionManager.open(state.sessionFile, PI_SESSION_DIR, PI_WORKSPACE)
				: SessionManager.continueRecent(PI_WORKSPACE, PI_SESSION_DIR);

		normalizeLegacySessionAssistantContent(sessionManager);

		seedConversationHistory(
			sessionManager,
			store.getMessagesForAI(conversationId),
		);

		const { session } = await createAgentSession({
			cwd: PI_WORKSPACE,
			agentDir: PI_AGENT_DIR,
			settingsManager,
			sessionManager,
			resourceLoader,
			...(selectedModel ? { model: selectedModel } : {}),
			tools: [...LIVE_SESSION_TOOL_NAMES],
			customTools: createPiCustomTools(
				conversationId,
				state,
				store,
				this.deliverer,
			),
		});

		state.sessionFile = session.sessionFile;
		state.id = session.sessionId || state.id;
		writeActiveRunMetadata(this.store, conversationId, state);

		return session as LiveConversationSession;
	}
}

export function getLiveRunCoordinator(): LiveRunCoordinator {
	if (!globalThis.__s3piaLiveRunCoordinator) {
		globalThis.__s3piaLiveRunCoordinator = new LiveRunCoordinator();
	}
	return globalThis.__s3piaLiveRunCoordinator;
}

export function startLiveRunCoordinator(
	conversationId = TELEGRAM_CONVERSATION_ID,
): void {
	getLiveRunCoordinator().start(conversationId);
}

export async function stopLiveRunCoordinator(): Promise<void> {
	await globalThis.__s3piaLiveRunCoordinator?.stop();
	globalThis.__s3piaLiveRunCoordinator = undefined;
}

declare global {
	// eslint-disable-next-line no-var
	var __s3piaLiveRunCoordinator: LiveRunCoordinator | undefined;
}
