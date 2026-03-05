/**
 * Heartbeat Scheduler
 *
 * Parses tasks/scheduled.md and executes tasks at scheduled times.
 * Uses human-readable "Every:" format instead of cron.
 *
 * Check interval: 10 minutes (aligned to :00/:10/:20/:30/:40/:50)
 */

import { Agent } from "./agent.js";
import { clearWorkspaceContextCache } from "./prompts.js";

const WORKSPACE = "/app/ws";
const TASKS_FILE = `${WORKSPACE}/tasks/scheduled.md`;
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

/**
 * Parse the "Every:" field and determine next run time
 */
function parseEvery(every: string, lastRun: Date, now: Date): Date | null {
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
		const tasksToExecute: ScheduledTask[] = [];
		const tasksToUpdate: ScheduledTask[] = [];
		const tasksToRemove: string[] = [];

		for (const task of tasks) {
			if (this.isTaskDue(task, now)) {
				tasksToExecute.push(task);

				if (task.runAt) {
					// One-time task - mark for removal
					tasksToRemove.push(task.name);
				} else {
					// Recurring task - mark for LastRun update
					tasksToUpdate.push({ ...task, lastRun: now.toISOString() });
				}
			}
		}

		// Execute tasks
		for (const task of tasksToExecute) {
			await this.executeTask(task);
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
			return this.parseTasks(content);
		} catch (err) {
			console.error("[Heartbeat] Parse error:", err);
			return [];
		}
	}

	/**
	 * Parse tasks from content
	 */
	private parseTasks(content: string): ScheduledTask[] {
		const tasks: ScheduledTask[] = [];

		// Find "Active Tasks" section - capture everything after it
		const activeSectionMatch = content.match(/##\s*Active Tasks\n([\s\S]*)/);
		if (!activeSectionMatch || !activeSectionMatch[1]) {
			return tasks;
		}

		const activeSection = activeSectionMatch[1];

		// Split by task headers (## at start of line with space after)
		// This handles multi-line content properly
		const parts = activeSection.split(/\n## /);

		for (const part of parts) {
			const lines = part.split("\n");
			const name = lines[0]?.trim();
			const body = lines.slice(1).join("\n").trim();

			// Skip if not a task (no field markers)
			if (
				!name ||
				(!body.includes("Action:") &&
					!body.includes("Every:") &&
					!body.includes("RunAt:"))
			) {
				continue;
			}

			const task: ScheduledTask = { name, action: "" };

			// Parse fields - multi-line aware
			// Action field can span multiple lines until next field or end
			const fieldRegex =
				/(?:^|\n)(Every|RunAt|LastRun|Action):\s*([\s\S]*?)(?=\n(?:Every|RunAt|LastRun|Action):|$)/g;
			const fieldMatches = Array.from(body.matchAll(fieldRegex));

			for (const fieldMatch of fieldMatches) {
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

			if (task.action) {
				tasks.push(task);
			}
		}

		return tasks;
	}

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
			// If no lastRun, use now as base to calculate next occurrence
			// This means new tasks run on their NEXT scheduled time, not immediately
			const lastRun = task.lastRun ? new Date(task.lastRun) : now;
			const nextRun = parseEvery(task.every, lastRun, now);
			if (!nextRun) return false;
			return now >= nextRun;
		}

		return false;
	}

	/**
	 * Execute a task using the Agent
	 */
	private async executeTask(task: ScheduledTask): Promise<void> {
		console.log(`[Heartbeat] Executing task: ${task.name}`);

		try {
			const agent = new Agent();
			// Wrap the task action with context that this is a scheduled task
			const contextualizedAction = `[SCHEDULED TASK: ${task.name}]

This is an automated scheduled task. Complete it and notify the user.

IMPORTANT: You MUST use the send_message tool to deliver the results. Choose:
- channel="telegram" for personal reminders
- channel="web" for general notifications
- channel="both" for important alerts

Task:
${task.action}`;

			const result = await agent.execute(contextualizedAction, []);

			if (result.blocked) {
				console.log(
					`[Heartbeat] Task ${task.name} blocked: ${result.question}`,
				);
			} else if (result.incomplete) {
				console.log(
					`[Heartbeat] Task ${task.name} incomplete after max iterations`,
				);
			} else {
				const resultPreview = result.result?.slice(0, 100) || "No result";
				console.log(
					`[Heartbeat] Task ${task.name} completed: ${resultPreview}...`,
				);
			}
		} catch (err) {
			console.error(`[Heartbeat] Task ${task.name} failed:`, err);
		}
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

			// Update LastRun for recurring tasks
			for (const task of updates) {
				const taskRegex = new RegExp(
					`(##\\s*${this.escapeRegex(task.name)}\\s*\\n((?:\\w+:\\s*.+\\n?)*))`,
					"g",
				);

				content = content.replace(taskRegex, (match) => {
					if (task.lastRun) {
						// Update or add LastRun
						if (match.includes("LastRun:")) {
							return match.replace(
								/LastRun:\s*[^\n]+/,
								`LastRun: ${task.lastRun}`,
							);
						}
						// Add LastRun after the Action line
						return match.replace(
							/(Action:\s*.+\n)/,
							`$1LastRun: ${task.lastRun}\n`,
						);
					}
					return match;
				});
			}

			// Remove one-time tasks
			for (const taskName of toRemove) {
				const taskRegex = new RegExp(
					`##\\s*${this.escapeRegex(taskName)}\\s*\\n(?:\\w+:\\s*.+\\n?)*\\n?`,
					"g",
				);
				content = content.replace(taskRegex, "");
				console.log(`[Heartbeat] Removed one-time task: ${taskName}`);
			}

			await Bun.write(TASKS_FILE, content);

			// Clear the workspace context cache so the updated file is re-read
			clearWorkspaceContextCache();
		} catch (err) {
			console.error("[Heartbeat] Failed to update file:", err);
		}
	}

	/**
	 * Escape special regex characters
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
