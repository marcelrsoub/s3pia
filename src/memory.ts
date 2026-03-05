/**
 * Memory System for Autonomous Agent
 *
 * Provides persistent storage for execution history and learned skills.
 * Uses SQLite for simple, reliable persistence.
 */

import { Database } from "bun:sqlite";

export interface Action {
	type: "tool" | "done" | "ask";
	tool?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	question?: string;
}

export interface ExecutionResult {
	task: string;
	result?: string;
	blocked?: boolean;
	question?: string;
	actions: Action[];
	iterations: number;
	duration: number;
	incomplete?: boolean;
	usedSendMessage?: boolean; // Track if agent used send_message tool
	error?: {
		type: "api_quota" | "api_auth" | "api_error" | "unknown";
		message: string;
		provider?: string;
		statusCode?: number;
	};
}

export interface Skill {
	id?: number;
	name: string;
	when_to_use: string;
	pattern: string;
	usage_count?: number;
	created_at?: number;
}

class Memory {
	private db: Database;
	private readonly DB_PATH = "/app/ws/s3pia.db";

	constructor(db?: Database) {
		// Use provided db or create new one
		this.db = db || new Database(this.DB_PATH);
		this.initialize();
	}

	private initialize(): void {
		// Enable WAL mode for better concurrency
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA foreign_keys = ON");

		// Create skills table
		this.db.run(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        when_to_use TEXT NOT NULL,
        pattern TEXT NOT NULL,
        usage_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

		// Create executions table
		this.db.run(`
      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY,
        task TEXT NOT NULL,
        result TEXT,
        actions TEXT,
        iterations INTEGER,
        duration INTEGER,
        incomplete INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

		// Create index for faster skill lookup
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_skills_usage ON skills(usage_count DESC)",
		);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at DESC)",
		);
	}

	// === Skills Management ===

	async getRelevantSkills(task: string): Promise<Skill[]> {
		try {
			// Simple keyword match for candidate skills
			const candidates = this.db
				.query(`
        SELECT * FROM skills
        ORDER BY usage_count DESC
        LIMIT 10
      `)
				.all() as Skill[];

			// Filter by simple keyword matching
			const taskLower = task.toLowerCase();
			return candidates.filter(
				(s) =>
					taskLower.includes(s.when_to_use.toLowerCase()) ||
					s.when_to_use
						.toLowerCase()
						.split(" ")
						.some((word) => taskLower.includes(word)),
			);
		} catch (err) {
			console.error("[Memory] Failed to get relevant skills:", err);
			return [];
		}
	}

	async saveSkill(
		skill: Omit<Skill, "id" | "usage_count" | "created_at">,
	): Promise<void> {
		try {
			this.db.run(
				`
        INSERT OR IGNORE INTO skills (name, when_to_use, pattern, created_at)
        VALUES (?, ?, ?, ?)
      `,
				[skill.name, skill.when_to_use, skill.pattern, Date.now()],
			);
			console.log(`[Memory] Saved skill: ${skill.name}`);
		} catch (err) {
			console.error("[Memory] Failed to save skill:", err);
		}
	}

	async incrementSkillUsage(skillName: string): Promise<void> {
		try {
			this.db.run(
				`
        UPDATE skills SET usage_count = usage_count + 1
        WHERE name = ?
      `,
				[skillName],
			);
		} catch (err) {
			console.error("[Memory] Failed to increment skill usage:", err);
		}
	}

	getAllSkills(): Skill[] {
		try {
			return this.db
				.query("SELECT * FROM skills ORDER BY usage_count DESC")
				.all() as Skill[];
		} catch (err) {
			console.error("[Memory] Failed to get all skills:", err);
			return [];
		}
	}

	// === Execution History ===

	async saveExecution(execution: ExecutionResult): Promise<void> {
		try {
			this.db.run(
				`
        INSERT INTO executions (task, result, actions, iterations, duration, incomplete, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
				[
					execution.task,
					execution.result || null,
					JSON.stringify(execution.actions),
					execution.iterations,
					execution.duration,
					execution.incomplete ? 1 : 0,
					Date.now(),
				],
			);
			console.log(
				`[Memory] Saved execution: ${execution.task.slice(0, 50)}...`,
			);
		} catch (err) {
			console.error("[Memory] Failed to save execution:", err);
		}
	}

	async getHistory(limit: number = 5): Promise<ExecutionResult[]> {
		try {
			const rows = this.db
				.query(`
        SELECT task, result, actions, iterations, duration, incomplete, created_at
        FROM executions
        ORDER BY created_at DESC
        LIMIT ?
      `)
				.all(limit) as Array<any>;

			return rows.map((row) => ({
				task: row.task,
				result: row.result,
				actions: JSON.parse(row.actions || "[]"),
				iterations: row.iterations,
				duration: row.duration,
				incomplete: row.incomplete === 1,
			}));
		} catch (err) {
			console.error("[Memory] Failed to get history:", err);
			return [];
		}
	}

	// === Cleanup ===

	async cleanupOldExecutions(
		maxAge: number = 7 * 24 * 60 * 60 * 1000,
	): Promise<void> {
		try {
			const cutoff = Date.now() - maxAge;
			const result = this.db.run(
				"DELETE FROM executions WHERE created_at < ?",
				[cutoff],
			);
			console.log(`[Memory] Cleaned up ${result.changes} old executions`);
		} catch (err) {
			console.error("[Memory] Failed to cleanup old executions:", err);
		}
	}

	close(): void {
		try {
			this.db.close();
		} catch (err) {
			console.error("[Memory] Error closing database:", err);
		}
	}
}

// Export singleton instance
let memoryInstance: Memory | null = null;

export function getMemory(): Memory {
	if (!memoryInstance) {
		memoryInstance = new Memory();
	}
	return memoryInstance;
}

export { Memory };
