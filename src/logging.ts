/**
 * Logging System
 *
 * Log everything: prompts, tool calls, outputs, errors.
 * Uses SQLite database at /app/ws/s3pia.db
 */

import { Database } from "bun:sqlite";

export interface LogEntry {
	id: string;
	timestamp: number;
	level: "info" | "warn" | "error" | "debug";
	category: "prompt" | "tool_call" | "output" | "error" | "decision";
	message: string;
	metadata?: string;
	jobId?: string;
}

class LoggingSystem {
	private db: Database;
	private readonly DB_PATH = "/app/ws/s3pia.db";

	constructor() {
		this.db = new Database(this.DB_PATH);
		this.initializeDatabase();
	}

	private initializeDatabase(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS logs (
				id TEXT PRIMARY KEY,
				timestamp INTEGER NOT NULL,
				level TEXT NOT NULL,
				category TEXT NOT NULL,
				message TEXT NOT NULL,
				metadata TEXT,
				job_id TEXT
			)
		`);

		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)",
		);
		this.db.run("CREATE INDEX IF NOT EXISTS idx_logs_job_id ON logs(job_id)");
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category)",
		);
	}

	log(
		level: LogEntry["level"],
		category: LogEntry["category"],
		message: string,
		metadata?: Record<string, unknown>,
		jobId?: string,
	): void {
		const id = `log-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
		const timestamp = Date.now();

		this.db.run(
			`INSERT INTO logs (id, timestamp, level, category, message, metadata, job_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				timestamp,
				level,
				category,
				message,
				metadata ? JSON.stringify(metadata) : null,
				jobId || null,
			],
		);

		// Also log to console
		const consoleMsg = `[${category.toUpperCase()}] ${message}`;
		switch (level) {
			case "error":
				console.error(consoleMsg);
				break;
			case "warn":
				console.warn(consoleMsg);
				break;
			case "debug":
				console.debug(consoleMsg);
				break;
			default:
				console.log(consoleMsg);
		}
	}

	info(
		category: LogEntry["category"],
		message: string,
		metadata?: Record<string, unknown>,
		jobId?: string,
	): void {
		this.log("info", category, message, metadata, jobId);
	}

	warn(
		category: LogEntry["category"],
		message: string,
		metadata?: Record<string, unknown>,
		jobId?: string,
	): void {
		this.log("warn", category, message, metadata, jobId);
	}

	error(
		category: LogEntry["category"],
		message: string,
		metadata?: Record<string, unknown>,
		jobId?: string,
	): void {
		this.log("error", category, message, metadata, jobId);
	}

	debug(
		category: LogEntry["category"],
		message: string,
		metadata?: Record<string, unknown>,
		jobId?: string,
	): void {
		this.log("debug", category, message, metadata, jobId);
	}

	// Query logs
	getLogs(jobId?: string, limit = 100): LogEntry[] {
		let query = "SELECT * FROM logs";
		const params: (string | number)[] = [];

		if (jobId) {
			query += " WHERE job_id = ?";
			params.push(jobId);
		}

		query += " ORDER BY timestamp DESC LIMIT ?";
		params.push(limit);

		return this.db.query(query).all(...params) as LogEntry[];
	}

	// Get recent logs for a job
	getJobLogs(jobId: string): LogEntry[] {
		return this.db
			.query("SELECT * FROM logs WHERE job_id = ? ORDER BY timestamp ASC")
			.all(jobId) as LogEntry[];
	}

	// Clear old logs
	clearOldLogs(olderThanMs = 7 * 24 * 60 * 60 * 1000): void {
		const cutoff = Date.now() - olderThanMs;
		this.db.run("DELETE FROM logs WHERE timestamp < ?", [cutoff]);
	}
}

export const logger = new LoggingSystem();

// Convenience functions
export function logPrompt(prompt: string, jobId: string): void {
	logger.info("prompt", "System prompt generated", { prompt }, jobId);
}

export function logToolCall(
	toolName: string,
	args: Record<string, unknown>,
	jobId: string,
): void {
	logger.info(
		"tool_call",
		`Tool called: ${toolName}`,
		{ toolName, args },
		jobId,
	);
}

export function logToolOutput(
	toolName: string,
	output: string,
	jobId: string,
): void {
	logger.info(
		"output",
		`Tool output: ${toolName}`,
		{ toolName, output },
		jobId,
	);
}

export function logDecision(
	decision: string,
	reasoning: string,
	jobId: string,
): void {
	logger.info("decision", decision, { reasoning }, jobId);
}

export function logError(error: Error, context: string, jobId?: string): void {
	logger.error(
		"error",
		context,
		{ error: error.message, stack: error.stack },
		jobId,
	);
}
