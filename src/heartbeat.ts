/**
 * Heartbeat Scheduler
 *
 * Parses tasks/scheduled.md and executes tasks at scheduled times.
 * Uses human-readable "Every:" format instead of cron.
 *
 * Check interval: 10 minutes (aligned to :00/:10/:20/:30/:40/:50)
 */

import { clearWorkspaceContextCache } from "./prompts.js";
import { getTaskQueue } from "./task-queue.js";
import { workspacePath } from "./workspace.js";

const TASKS_FILE = workspacePath("tasks", "scheduled.md");
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Calculate milliseconds until the next aligned time (:00, :10, :20, :30, :40, :50)
 */
function msUntilNextAlignedTime(): number {
	const now = new Date();
	const minutes = now.getMinutes();
	const seconds = now.getSeconds();
	const ms = now.getMilliseconds();

	const minutesToNext = 10 - (minutes % 10);

	const msToNext = minutesToNext * 60 * 1000 - seconds * 1000 - ms;

	return msToNext;
}

/**
 * Scheduled task with human-readable schedule format
 */
export interface ScheduledTask {
	name: string;
	action: string;
	every?: string; // "30 minutes", "1 day at 09:00", "Monday at 00:00"
	runAt?: string; // ISO timestamp for one-time
	lastRun?: string; // ISO timestamp
}

export function parseScheduledTasks(content: string): ScheduledTask[] {
	const tasks: ScheduledTask[] = [];
	const activeSectionMatch = content.match(/##\s*Active Tasks\n([\s\S]*)/);
	if (!activeSectionMatch?.[1]) return tasks;

	const parts = activeSectionMatch[1].split(/\n## /);
	for (const part of parts) {
		const lines = part.split("\n");
		const name = lines[0]?.trim();
		const body = lines.slice(1).join("\n").trim();
		if (
			!name ||
			(!body.includes("Action:") &&
				!body.includes("Every:") &&
				!body.includes("RunAt:"))
		) {
			continue;
		}

		const task: ScheduledTask = { name, action: "" };
		const fieldRegex =
			/(?:^|\n)(Every|RunAt|LastRun|Action):\s*([\s\S]*?)(?=\n(?:Every|RunAt|LastRun|Action):|$)/g;
		for (const fieldMatch of body.matchAll(fieldRegex)) {
			const key = fieldMatch[1]?.toLowerCase();
			const value = (fieldMatch[2] ?? "").trim();
			switch (key) {
				case "action":
					task.action = value;
					break;
				case "every":
					task.every = value;
					break;
				case "runat":
					task.runAt = value;
					break;
				case "lastrun":
					task.lastRun = value;
					break;
			}
		}

		if (task.action) tasks.push(task);
	}

	return tasks;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function updateScheduledTasksContent(
	content: string,
	updates: ScheduledTask[],
	toRemove: string[],
): string {
	for (const task of updates) {
		const taskRegex = new RegExp(
			`(^##\\s*${escapeRegex(task.name)}\\s*\\n)[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`,
			"gm",
		);
		content = content.replace(taskRegex, (match) => {
			if (!task.lastRun) return match;
			if (match.includes("LastRun:")) {
				return match.replace(/LastRun:\s*[^\n]+/, `LastRun: ${task.lastRun}`);
			}
			return `${match.trimEnd()}\nLastRun: ${task.lastRun}\n\n`;
		});
	}

	for (const taskName of toRemove) {
		const taskRegex = new RegExp(
			`^##\\s*${escapeRegex(taskName)}\\s*\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`,
			"gm",
		);
		content = content.replace(taskRegex, "");
	}

	return content;
}

/**
 * Parse the "Every:" field and determine next run time
 */
function parseEvery(every: string, lastRun: Date): Date | null {
	const everyLower = every.toLowerCase().trim();

	// "X minutes" - every X minutes
	const minutesMatch = everyLower.match(/^(\d+)\s*minutes?$/);
	if (minutesMatch) {
		const minutes = Number.parseInt(minutesMatch[1] ?? "0", 10);
		return new Date(lastRun.getTime() + minutes * 60_000);
	}

	// "X hours" - every X hours
	const hoursMatch = everyLower.match(/^(\d+)\s*hours?$/);
	if (hoursMatch) {
		const hours = Number.parseInt(hoursMatch[1] ?? "0", 10);
		return new Date(lastRun.getTime() + hours * 60 * 60_000);
	}

	// "X days at HH:MM" or "X days" - every X days
	const daysMatch = everyLower.match(
		/^(\d+)\s*days?(?:\s+at\s+(\d{1,2}):(\d{2}))?$/,
	);
	if (daysMatch) {
		const days = Number.parseInt(daysMatch[1] ?? "1", 10);
		const hour = daysMatch[2]
			? Number.parseInt(daysMatch[2], 10)
			: lastRun.getHours();
		const minute = daysMatch[3]
			? Number.parseInt(daysMatch[3], 10)
			: lastRun.getMinutes();

		// Calculate next occurrence after lastRun
		const next = new Date(lastRun);
		next.setDate(next.getDate() + days);
		next.setHours(hour, minute, 0, 0);

		// If this time is not after lastRun, advance by another period
		while (next.getTime() <= lastRun.getTime()) {
			next.setDate(next.getDate() + days);
		}

		return next;
	}

	// "DayName at HH:MM" - weekly on specific day
	const dayNames = [
		"sunday",
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
	];
	const weeklyMatch = everyLower.match(
		/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2}):(\d{2})$/i,
	);
	if (weeklyMatch) {
		const targetDay = dayNames.indexOf((weeklyMatch[1] ?? "").toLowerCase());
		const hour = Number.parseInt(weeklyMatch[2] ?? "0", 10);
		const minute = Number.parseInt(weeklyMatch[3] ?? "0", 10);

		// Start from lastRun and find next occurrence
		const next = new Date(lastRun);
		next.setHours(hour, minute, 0, 0);

		// Find next occurrence of target day
		const currentDay = next.getDay();
		const daysUntilTarget = (targetDay - currentDay + 7) % 7;

		next.setDate(next.getDate() + daysUntilTarget);

		// If this time is not after lastRun, advance by a week
		if (next.getTime() <= lastRun.getTime()) {
			next.setDate(next.getDate() + 7);
		}

		return next;
	}

	// Unknown format
	console.error(`[Heartbeat] Unknown schedule format: ${every}`);
	return null;
}

export class HeartbeatScheduler {
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;

	/**
	 * Start the heartbeat scheduler
	 */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		const msToNext = msUntilNextAlignedTime();
		const nextCheck = new Date(Date.now() + msToNext);
		console.log(
			`[Heartbeat] Starting scheduler (aligned to :00/:10/:20..., next check at ${nextCheck.toISOString()})...`,
		);

		// Wait until the next aligned time
		await new Promise((resolve) => setTimeout(resolve, msToNext));

		// Run first check at aligned time
		await this.checkAndExecute();

		// Schedule periodic checks every 10 minutes (now aligned)
		this.timer = setInterval(() => {
			this.checkAndExecute().catch((err) => {
				console.error("[Heartbeat] Check error:", err);
			});
		}, CHECK_INTERVAL_MS);

		console.log("[Heartbeat] Scheduler started");
	}

	/**
	 * Stop the heartbeat scheduler
	 */
	async stop(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.running = false;
		console.log("[Heartbeat] Scheduler stopped");
	}

	/**
	 * Check if scheduler is running
	 */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Check for due tasks and execute them
	 */
	private async checkAndExecute(): Promise<void> {
		console.log("[Heartbeat] Checking for due tasks...");
		const tasks = await this.parseTasksFile();
		const now = new Date();
		const tasksToUpdate: ScheduledTask[] = [];
		const tasksToRemove: string[] = [];

		for (const task of tasks) {
			if (this.isTaskDue(task, now)) {
				const queuedTask = this.queueTask(task);
				if (queuedTask.status === "completed") {
					if (task.runAt) {
						tasksToRemove.push(task.name);
					} else {
						tasksToUpdate.push({ ...task, lastRun: now.toISOString() });
					}
				} else if (queuedTask.status === "failed") {
					getTaskQueue().retry(queuedTask.sourceKey);
				}
			}
		}

		// Update file if needed
		if (tasksToRemove.length > 0 || tasksToUpdate.length > 0) {
			await this.updateTasksFile(tasksToUpdate, tasksToRemove);
		} else {
			console.log("[Heartbeat] No tasks due");
		}
	}

	/**
	 * Parse tasks/scheduled.md and extract tasks from "Active Tasks" section
	 */
	private async parseTasksFile(): Promise<ScheduledTask[]> {
		try {
			const file = Bun.file(TASKS_FILE);
			if (!(await file.exists())) {
				console.log("[Heartbeat] No tasks/scheduled.md file found");
				return [];
			}

			const content = await file.text();
			return parseScheduledTasks(content);
		} catch (err) {
			console.error("[Heartbeat] Parse error:", err);
			return [];
		}
	}

	/**
	 * Parse tasks from content
	 */
	/**
	 * Check if a task is due for execution
	 */
	private isTaskDue(task: ScheduledTask, now: Date): boolean {
		// One-time task (RunAt)
		if (task.runAt) {
			const runAtTime = new Date(task.runAt);
			return now >= runAtTime;
		}

		// Recurring task (Every)
		if (task.every) {
			if (!task.lastRun) {
				return true;
			}

			const lastRun = new Date(task.lastRun);
			const nextRun = parseEvery(task.every, lastRun);
			if (!nextRun) return false;
			return now >= nextRun;
		}

		return false;
	}

	/**
	 * Execute a task using the Agent
	 */
	private queueTask(task: ScheduledTask) {
		const contextualizedAction = `[SCHEDULED TASK: ${task.name}]

This is an automated scheduled task. Complete it and notify the user.

IMPORTANT: Use the send_message tool to deliver the final result to Telegram.

Task:
${task.action}`;
		const dueKey = task.runAt || task.lastRun || "initial";
		return getTaskQueue().enqueue({
			kind: "scheduled",
			sourceKey: `scheduled:${task.name}:${dueKey}`,
			input: contextualizedAction,
		}).task;
	}

	/**
	 * Update tasks/scheduled.md with new LastRun values and remove one-time tasks
	 */
	private async updateTasksFile(
		updates: ScheduledTask[],
		toRemove: string[],
	): Promise<void> {
		try {
			const file = Bun.file(TASKS_FILE);
			let content = await file.text();
			content = updateScheduledTasksContent(content, updates, toRemove);
			for (const taskName of toRemove) {
				console.log(`[Heartbeat] Removed one-time task: ${taskName}`);
			}

			await Bun.write(TASKS_FILE, content);

			// Clear the workspace context cache so the updated file is re-read
			clearWorkspaceContextCache();
		} catch (err) {
			console.error("[Heartbeat] Failed to update file:", err);
		}
	}
}

// Singleton instance
let schedulerInstance: HeartbeatScheduler | null = null;

export function getHeartbeatScheduler(): HeartbeatScheduler {
	if (!schedulerInstance) {
		schedulerInstance = new HeartbeatScheduler();
	}
	return schedulerInstance;
}

export async function startHeartbeat(): Promise<void> {
	const scheduler = getHeartbeatScheduler();
	await scheduler.start();
}

export async function stopHeartbeat(): Promise<void> {
	if (schedulerInstance) {
		await schedulerInstance.stop();
	}
}
