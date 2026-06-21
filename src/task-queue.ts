import { Database } from "bun:sqlite";
import { Agent } from "./agent.js";
import { buildThreadState } from "./ai-tools.js";
import {
	conversationStore,
	type Message,
	TELEGRAM_CONVERSATION_ID,
} from "./conversation.js";
import type { ExecutionResult } from "./memory.js";
import { sendTelegramMessageToAdmin } from "./telegram-client.js";
import { workspacePath } from "./workspace.js";

export type TaskStatus =
	| "queued"
	| "running"
	| "blocked"
	| "completed"
	| "failed";

export interface QueueTask {
	id: number;
	kind: "telegram" | "scheduled";
	sourceKey: string;
	input: string;
	history: Message[];
	status: TaskStatus;
	result?: string;
	question?: string;
	error?: string;
	deliveryStatus: "none" | "pending" | "sent";
	attempts: number;
	createdAt: number;
	updatedAt: number;
}

interface EnqueueTask {
	kind: QueueTask["kind"];
	sourceKey: string;
	input: string;
	history?: Message[];
}

type TaskExecutor = (
	input: string,
	history: Message[],
) => Promise<ExecutionResult>;
type TaskDeliverer = (text: string) => Promise<boolean>;

interface TaskRow {
	id: number;
	kind: QueueTask["kind"];
	source_key: string;
	input: string;
	history: string;
	status: TaskStatus;
	result: string | null;
	question: string | null;
	error: string | null;
	delivery_status: QueueTask["deliveryStatus"];
	attempts: number;
	created_at: number;
	updated_at: number;
}

function hasSuccessfulAgentDelivery(result: ExecutionResult): boolean {
	return result.actions.some((action) => {
		if (
			action.tool !== "send_message" ||
			typeof action.result !== "object" ||
			action.result === null ||
			!("messageDelivered" in action.result)
		) {
			return false;
		}
		return action.result.messageDelivered === true;
	});
}

function summarizeTaskPreview(text: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (normalized.length <= 140) return normalized;
	return `${normalized.slice(0, 137).trimEnd()}...`;
}

function messageKey(message: Message): string {
	return [
		message.role,
		message.timestamp,
		message.source || "",
		message.workerType || "",
		message.workerStatus || "",
		message.content,
		JSON.stringify(message.files || []),
	].join("|");
}

function mergeMessageStreams(base: Message[], live: Message[]): Message[] {
	const merged: Message[] = [];
	const seen = new Set<string>();

	for (const message of [...base, ...live]) {
		const key = messageKey(message);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(message);
	}

	return merged;
}

export class TaskQueue {
	private db: Database;
	private processing = false;
	private started = false;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		dbPath = workspacePath("s3pia.db"),
		private readonly executor: TaskExecutor = async (input, history) =>
			new Agent().execute(input, history),
		private readonly deliverer: TaskDeliverer = async (text) =>
			(await sendTelegramMessageToAdmin(text)).ok,
	) {
		this.db = new Database(dbPath);
		this.db.run("PRAGMA journal_mode = WAL");
		this.initialize();
	}

	private initialize(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS agent_tasks (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				kind TEXT NOT NULL,
				source_key TEXT NOT NULL UNIQUE,
				input TEXT NOT NULL,
				history TEXT NOT NULL DEFAULT '[]',
				status TEXT NOT NULL,
				result TEXT,
				question TEXT,
				error TEXT,
				delivery_status TEXT NOT NULL DEFAULT 'none',
				attempts INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, created_at)",
		);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS agent_task_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				task_id INTEGER NOT NULL,
				event TEXT NOT NULL,
				details TEXT,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
			)
		`);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_agent_task_events_task ON agent_task_events(task_id, created_at)",
		);
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		const now = Date.now();
		const staleTasks = this.db
			.query("SELECT id FROM agent_tasks WHERE status = 'running'")
			.all() as Array<{ id: number }>;
		this.db.run(
			`UPDATE agent_tasks
			 SET status = 'queued', error = 'Recovered after restart', updated_at = ?
			 WHERE status = 'running'`,
			[now],
		);
		for (const task of staleTasks) {
			this.recordEvent(task.id, "recovered", "Recovered after restart");
		}
		this.timer = setInterval(() => void this.process(), 1_000);
		void this.process();
	}

	stop(): void {
		this.started = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	async close(): Promise<void> {
		this.stop();
		while (this.processing) {
			await Bun.sleep(5);
		}
		this.db.close();
	}

	enqueue(task: EnqueueTask): { task: QueueTask; created: boolean } {
		const existing = this.getBySourceKey(task.sourceKey);
		if (existing) return { task: existing, created: false };

		const now = Date.now();
		this.db.run(
			`INSERT INTO agent_tasks
			 (kind, source_key, input, history, status, delivery_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'queued', 'none', ?, ?)`,
			[
				task.kind,
				task.sourceKey,
				task.input,
				JSON.stringify(task.history || []),
				now,
				now,
			],
		);

		const created = this.getBySourceKey(task.sourceKey);
		if (!created) throw new Error("Failed to create queued task");
		this.recordEvent(created.id, "queued");
		if (task.kind === "telegram") {
			this.syncTelegramThreadState(created, "queued");
		}
		if (this.started) void this.process();
		return { task: created, created: true };
	}

	getBySourceKey(sourceKey: string): QueueTask | null {
		const row = this.db
			.query("SELECT * FROM agent_tasks WHERE source_key = ?")
			.get(sourceKey) as TaskRow | null;
		return row ? this.mapRow(row) : null;
	}

	getLatest(): QueueTask | null {
		const row = this.db
			.query("SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 1")
			.get() as TaskRow | null;
		return row ? this.mapRow(row) : null;
	}

	getLatestActive(): QueueTask | null {
		const row = this.db
			.query(
				"SELECT * FROM agent_tasks WHERE status IN ('queued', 'running', 'blocked') ORDER BY updated_at DESC LIMIT 1",
			)
			.get() as TaskRow | null;
		return row ? this.mapRow(row) : null;
	}

	getLatestBlocked(): QueueTask | null {
		const row = this.db
			.query(
				"SELECT * FROM agent_tasks WHERE status = 'blocked' ORDER BY updated_at DESC LIMIT 1",
			)
			.get() as TaskRow | null;
		return row ? this.mapRow(row) : null;
	}

	getBacklogCount(): number {
		const row = this.db
			.query(
				"SELECT COUNT(*) AS count FROM agent_tasks WHERE status IN ('queued', 'running')",
			)
			.get() as { count: number } | null;
		return row?.count || 0;
	}

	retry(sourceKey: string): boolean {
		const task = this.getBySourceKey(sourceKey);
		if (!task || task.status !== "failed") return false;
		this.db.run(
			`UPDATE agent_tasks
			 SET status = 'queued', error = NULL, delivery_status = 'none', updated_at = ?
			 WHERE source_key = ?`,
			[Date.now(), sourceKey],
		);
		this.recordEvent(task.id, "retried");
		if (task.kind === "telegram") {
			this.syncTelegramThreadState(task, "queued");
		}
		if (this.started) void this.process();
		return true;
	}

	resumeBlockedTask(
		taskId: number,
		input: string,
		history?: Message[],
		checkpointAt: number = Date.now(),
	): QueueTask | null {
		const existing = this.db
			.query("SELECT * FROM agent_tasks WHERE id = ?")
			.get(taskId) as TaskRow | null;
		if (!existing || existing.status !== "blocked") {
			return null;
		}

		const existingHistory = JSON.parse(existing.history) as Message[];
		const nextHistory = history
			? mergeMessageStreams(existingHistory, history)
			: existingHistory;
		const now = Date.now();
		this.db.run(
			`UPDATE agent_tasks
			 SET input = ?, history = ?, status = 'queued', result = NULL, question = NULL, error = NULL, delivery_status = 'none', updated_at = ?
			 WHERE id = ?`,
			[
				input,
				JSON.stringify(nextHistory),
				now,
				taskId,
			],
		);
		this.recordEvent(taskId, "resumed");

		const updated = this.getById(taskId);
		if (updated) {
			this.syncTelegramThreadState(updated, "queued", undefined, checkpointAt);
		}
		if (this.started) void this.process();
		return updated;
	}

	continueTelegramTask(
		sourceKey: string,
		input: string,
		history: Message[] = [],
		checkpointAt?: number,
	): QueueTask | null {
		const task = this.getBySourceKey(sourceKey);
		if (!task || task.kind !== "telegram" || task.status !== "blocked") {
			return null;
		}

		return this.resumeBlockedTask(task.id, input, history, checkpointAt);
	}

	private async process(): Promise<void> {
		if (!this.started || this.processing) return;
		this.processing = true;
		try {
			await this.retryPendingDeliveries();
			const row = this.db
				.query(
					"SELECT * FROM agent_tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
				)
				.get() as TaskRow | null;
			if (!row) return;

			const task = this.mapRow(row);
			const threadState =
				task.kind === "telegram"
					? buildThreadState(TELEGRAM_CONVERSATION_ID, task.createdAt)
					: null;
			const executionHistory =
				task.kind === "telegram"
					? mergeMessageStreams(
							task.history,
							conversationStore.getMessagesForAI(TELEGRAM_CONVERSATION_ID),
						)
					: task.history;
			const executionInput =
				task.kind === "telegram" && threadState
					? `${task.input}\n\nLive thread snapshot:\n${threadState.summary}`
					: task.input;
			this.db.run(
				`UPDATE agent_tasks
				 SET status = 'running', attempts = attempts + 1, updated_at = ?
				 WHERE id = ? AND status = 'queued'`,
				[Date.now(), task.id],
			);
			this.recordEvent(task.id, "running");
			if (task.kind === "telegram") {
				this.syncTelegramThreadState(task, "running");
			}

			try {
				const result = await this.executor(executionInput, executionHistory);
				const deliveredByAgent = hasSuccessfulAgentDelivery(result);
				const now = Date.now();

				if (result.blocked) {
					this.db.run(
						`UPDATE agent_tasks
						 SET status = 'blocked', question = ?, result = ?, delivery_status = ?, updated_at = ?
						 WHERE id = ?`,
						[
							result.question || "I need more information to continue.",
							result.result || null,
							deliveredByAgent ? "sent" : "pending",
							now,
							task.id,
						],
					);
					this.recordEvent(
						task.id,
						"blocked",
						result.question || "More information required",
					);
					if (task.kind === "telegram") {
						this.syncTelegramThreadState(task, "blocked", result);
					}
				} else if (result.incomplete || result.error) {
					this.db.run(
						`UPDATE agent_tasks
						 SET status = 'failed', result = ?, error = ?, delivery_status = ?, updated_at = ?
						 WHERE id = ?`,
						[
							result.result || null,
							result.error?.message || "Task did not complete",
							deliveredByAgent ? "sent" : "pending",
							now,
							task.id,
						],
					);
					this.recordEvent(
						task.id,
						"failed",
						result.error?.message || "Task did not complete",
					);
					if (task.kind === "telegram") {
						this.syncTelegramThreadState(task, "failed", result);
					}
				} else {
					this.db.run(
						`UPDATE agent_tasks
						 SET status = 'completed', result = ?, delivery_status = ?, updated_at = ?
						 WHERE id = ?`,
						[
							result.result || "Task completed",
							deliveredByAgent ? "sent" : "pending",
							now,
							task.id,
						],
					);
					this.recordEvent(task.id, "completed");
					if (task.kind === "telegram") {
						this.syncTelegramThreadState(task, "completed", result);
					}
				}
			} catch (error) {
				this.db.run(
					`UPDATE agent_tasks
					 SET status = 'failed', error = ?, delivery_status = 'pending', updated_at = ?
					 WHERE id = ?`,
					[
						error instanceof Error ? error.message : "Unknown task error",
						Date.now(),
						task.id,
					],
				);
				this.recordEvent(
					task.id,
					"failed",
					error instanceof Error ? error.message : "Unknown task error",
				);
				if (task.kind === "telegram") {
					this.syncTelegramThreadState(task, "failed");
				}
			}

			await this.retryPendingDeliveries();
		} finally {
			this.processing = false;
			if (
				this.started &&
				this.db
					.query("SELECT id FROM agent_tasks WHERE status = 'queued' LIMIT 1")
					.get()
			) {
				queueMicrotask(() => void this.process());
			}
		}
	}

	private async retryPendingDeliveries(): Promise<void> {
		const rows = this.db
			.query(
				`SELECT * FROM agent_tasks
				 WHERE delivery_status = 'pending'
				 AND status IN ('blocked', 'completed', 'failed')
				 ORDER BY updated_at ASC`,
			)
			.all() as TaskRow[];

		for (const row of rows) {
			const task = this.mapRow(row);
			const text =
				task.status === "blocked"
					? task.question || "I need more information to continue."
					: task.status === "failed"
						? `Task failed: ${task.error || task.result || "Unknown error"}`
						: task.result || "Task completed";

			let delivered = false;
			try {
				delivered = await this.deliverer(text);
			} catch (error) {
				console.error(
					`[TaskQueue] Delivery failed for task ${task.id}:`,
					error,
				);
			}

			if (delivered) {
				this.db.run(
					"UPDATE agent_tasks SET delivery_status = 'sent', updated_at = ? WHERE id = ?",
					[Date.now(), task.id],
				);
				this.recordEvent(task.id, "delivered");
				conversationStore.addMessage(
					TELEGRAM_CONVERSATION_ID,
					"assistant",
					text,
					"telegram",
				);
			}
		}
	}

	private recordEvent(taskId: number, event: string, details?: string): void {
		this.db.run(
			`INSERT INTO agent_task_events (task_id, event, details, created_at)
			 VALUES (?, ?, ?, ?)`,
			[taskId, event, details || null, Date.now()],
		);
	}

	private syncTelegramThreadState(
		task: QueueTask,
		status: TaskStatus,
		result?: ExecutionResult,
		checkpointAt: number = Date.now(),
	): void {
		const previewSource =
			result?.result || task.result || task.question || task.input || "";
		conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
			activeTaskId: task.id,
			activeTaskSourceKey: task.sourceKey,
			activeTaskStatus: status,
			activeTaskPreview: summarizeTaskPreview(previewSource),
			activeTaskQuestion: task.question,
			activeTaskStartedAt: task.createdAt,
			activeTaskUpdatedAt: checkpointAt,
		});
	}

	private mapRow(row: TaskRow): QueueTask {
		return {
			id: row.id,
			kind: row.kind,
			sourceKey: row.source_key,
			input: row.input,
			history: JSON.parse(row.history) as Message[],
			status: row.status,
			result: row.result || undefined,
			question: row.question || undefined,
			error: row.error || undefined,
			deliveryStatus: row.delivery_status,
			attempts: row.attempts,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private getById(id: number): QueueTask | null {
		const row = this.db
			.query("SELECT * FROM agent_tasks WHERE id = ?")
			.get(id) as TaskRow | null;
		return row ? this.mapRow(row) : null;
	}
}

let queueInstance: TaskQueue | null = null;

export function getTaskQueue(): TaskQueue {
	if (!queueInstance) queueInstance = new TaskQueue();
	return queueInstance;
}

export function startTaskQueue(): void {
	getTaskQueue().start();
}

export function stopTaskQueue(): void {
	if (queueInstance) queueInstance.stop();
}
