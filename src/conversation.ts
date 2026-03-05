/**
 * Conversation Store (Simplified)
 *
 * SQLite-backed conversation memory with in-memory caching.
 * Clean, focused implementation.
 */

import { Database } from "bun:sqlite";

export interface Message {
	role: "user" | "assistant" | "system" | "worker";
	content: string;
	timestamp: number;
	source?: "web" | "telegram";
	workerType?: "tool" | "bash";
	workerStatus?: "started" | "completed" | "failed";
	files?: Array<{
		filename: string;
		path: string;
		size?: number;
		downloadUrl: string;
	}>;
}

export interface Conversation {
	id: string;
	messages: Message[];
	createdAt: number;
	lastActivity: number;
}

class ConversationStore {
	private conversations: Map<string, Conversation> = new Map();
	private maxMessages = 50;
	private maxConversations = 100;
	private db: Database | null = null;
	private readonly DB_PATH = "/app/ws/s3pia.db";
	private telegramCallback?: (content: string) => void;

	constructor() {
		this.initDatabase();
		this.loadFromDatabase();
	}

	private initDatabase(): void {
		try {
			this.db = new Database(this.DB_PATH);
			this.db.run("PRAGMA journal_mode = WAL");
			this.db.run("PRAGMA foreign_keys = ON");

			// Create tables
			this.db.run(`
				CREATE TABLE IF NOT EXISTS conversations (
					id TEXT PRIMARY KEY,
					created_at INTEGER NOT NULL,
					last_activity INTEGER NOT NULL
				)
			`);

			this.db.run(`
				CREATE TABLE IF NOT EXISTS messages (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					conversation_id TEXT NOT NULL,
					role TEXT NOT NULL,
					content TEXT NOT NULL,
					timestamp INTEGER NOT NULL,
					source TEXT,
					worker_type TEXT,
					worker_status TEXT,
					FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
				)
			`);

			// Create indexes
			this.db.run(
				"CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)",
			);
			this.db.run(
				"CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations(last_activity)",
			);

			// Migration: Add files column if it doesn't exist
			try {
				this.db.run("ALTER TABLE messages ADD COLUMN files TEXT");
			} catch {
				// Column already exists, ignore
			}

			console.log("[ConversationStore] Database initialized");
		} catch (err) {
			console.error("[ConversationStore] Failed to initialize database:", err);
		}
	}

	private loadFromDatabase(): void {
		if (!this.db) return;

		try {
			const convs = this.db
				.query("SELECT id, created_at, last_activity FROM conversations")
				.all() as Array<{
				id: string;
				created_at: number;
				last_activity: number;
			}>;

			for (const conv of convs) {
				const messages = this.db
					.query(
						"SELECT role, content, timestamp, source, worker_type, worker_status, files FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
					)
					.all(conv.id) as Array<{
					role: string;
					content: string;
					timestamp: number;
					source?: string;
					worker_type?: string;
					worker_status?: string;
					files?: string;
				}>;

				this.conversations.set(conv.id, {
					id: conv.id,
					messages: messages.map((m) => ({
						role: m.role as "user" | "assistant" | "system" | "worker",
						content: m.content,
						timestamp: m.timestamp,
						source: m.source as "web" | "telegram" | undefined,
						workerType: m.worker_type as "tool" | "bash" | undefined,
						workerStatus: m.worker_status as
							| "started"
							| "completed"
							| "failed"
							| undefined,
						files: m.files ? JSON.parse(m.files) : undefined,
					})),
					createdAt: conv.created_at,
					lastActivity: conv.last_activity,
				});
			}

			console.log(`[ConversationStore] Loaded ${convs.length} conversations`);
			this.cleanup();
		} catch (err) {
			console.error("[ConversationStore] Failed to load from database:", err);
		}
	}

	create(id: string): Conversation {
		const conv: Conversation = {
			id,
			messages: [],
			createdAt: Date.now(),
			lastActivity: Date.now(),
		};

		this.conversations.set(id, conv);

		if (this.db) {
			try {
				this.db.run(
					"INSERT INTO conversations (id, created_at, last_activity) VALUES (?, ?, ?)",
					[id, conv.createdAt, conv.lastActivity],
				);
			} catch (err) {
				console.error("[ConversationStore] Failed to save conversation:", err);
			}
		}

		this.cleanup();
		return conv;
	}

	get(id: string): Conversation | undefined {
		return this.conversations.get(id);
	}

	addMessage(
		conversationId: string,
		role: "user" | "assistant" | "worker",
		content: string,
		source?: "web" | "telegram",
		workerType?: "tool" | "bash",
		workerStatus?: "started" | "completed" | "failed",
		files?: Message["files"],
	): void {
		let conv = this.conversations.get(conversationId);
		if (!conv) {
			conv = this.create(conversationId);
		}

		const message: Message = {
			role,
			content,
			timestamp: Date.now(),
			source,
			workerType,
			workerStatus,
			files,
		};

		conv.messages.push(message);
		conv.lastActivity = message.timestamp;

		// Trim if too many messages
		if (conv.messages.length > this.maxMessages) {
			const toTrim = conv.messages.length - this.maxMessages;
			if (toTrim > 0) {
				// Remove oldest non-system messages
				let trimmed = 0;
				for (let i = 0; i < conv.messages.length && trimmed < toTrim; i++) {
					if (conv.messages[i].role !== "system") {
						conv.messages.splice(i, 1);
						i--;
						trimmed++;
					}
				}
			}
		}

		// Save to database
		if (this.db) {
			try {
				this.db.run(
					`INSERT INTO messages (conversation_id, role, content, timestamp, source, worker_type, worker_status, files)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						conversationId,
						role,
						content,
						message.timestamp,
						source || null,
						workerType || null,
						workerStatus || null,
						files ? JSON.stringify(files) : null,
					],
				);

				// Update last activity
				this.db.run("UPDATE conversations SET last_activity = ? WHERE id = ?", [
					message.timestamp,
					conversationId,
				]);
			} catch (err) {
				console.error("[ConversationStore] Failed to save message:", err);
			}
		}

		// Trigger Telegram callback if set
		if (
			role === "assistant" &&
			source === "telegram" &&
			this.telegramCallback
		) {
			// Extract file references and send to Telegram
			this.telegramCallback(content);
		}
	}

	clear(id: string): void {
		const conv = this.conversations.get(id);
		if (!conv) return;

		conv.messages = [];
		conv.lastActivity = Date.now();

		if (this.db) {
			try {
				this.db.run("DELETE FROM messages WHERE conversation_id = ?", [id]);
				this.db.run("UPDATE conversations SET last_activity = ? WHERE id = ?", [
					Date.now(),
					id,
				]);
			} catch (err) {
				console.error("[ConversationStore] Failed to clear conversation:", err);
			}
		}
	}

	getMessagesForAI(conversationId: string): Message[] {
		const conv = this.conversations.get(conversationId);
		if (!conv) return [];

		// Return messages for AI context (exclude worker messages)
		return conv.messages.filter(
			(m) => m.role !== "worker" || m.workerStatus !== "failed",
		);
	}

	registerTelegramCallback(callback: (content: string) => void): void {
		this.telegramCallback = callback;
	}

	list(): Conversation[] {
		return Array.from(this.conversations.values()).sort(
			(a, b) => b.lastActivity - a.lastActivity,
		);
	}

	cleanup(): void {
		// Clean up old conversations
		const now = Date.now();
		const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

		for (const [id, conv] of this.conversations.entries()) {
			if (
				now - conv.lastActivity > maxAge ||
				this.conversations.size > this.maxConversations
			) {
				this.conversations.delete(id);
				if (this.db) {
					try {
						this.db.run("DELETE FROM conversations WHERE id = ?", [id]);
						this.db.run("DELETE FROM messages WHERE conversation_id = ?", [id]);
					} catch (err) {
						console.error(
							"[ConversationStore] Failed to delete conversation:",
							err,
						);
					}
				}
			}
		}
	}

	shutdown(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			console.log("[ConversationStore] Database closed");
		}
	}
}

// Global instance
export const conversationStore = new ConversationStore();

// Session-based conversation ID from request
export function getConversationId(request: Request): string {
	const url = new URL(request.url);
	const sessionParam = url.searchParams.get("conversation");
	if (sessionParam) return sessionParam;

	// Use session cookie if available
	const cookieHeader = request.headers.get("Cookie");
	if (cookieHeader) {
		const sessionMatch = cookieHeader.match(/conversation=([^;]+)/);
		if (sessionMatch) return sessionMatch[1];
	}

	return "default";
}
