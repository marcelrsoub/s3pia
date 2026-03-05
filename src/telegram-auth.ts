/**
 * Telegram Bot Authorization Module
 *
 * Handles whitelist-based authorization for Telegram bot users.
 * Only authorized users can interact with the bot.
 *
 * The first admin user is configured via the ADMIN_TELEGRAM_ID environment variable.
 */

import { Database } from "bun:sqlite";

// Telegram user types
export interface TelegramUser {
	telegramId: number;
	username?: string;
	firstName?: string;
	role: "admin" | "user";
	createdAt: number;
	lastSeen: number;
}

// Authorization result
export interface AuthResult {
	authorized: boolean;
	user?: TelegramUser;
	reason?: string;
}

class TelegramAuthStore {
	private db: Database | null = null;
	private readonly DB_PATH = "/app/ws/s3pia.db";
	private usersCache: Map<number, TelegramUser> = new Map();

	constructor() {
		this.initializeDatabase();
		this.loadUsers();
		this.initializeAdminUser();
	}

	// Initialize database table for telegram users
	private initializeDatabase(): void {
		try {
			this.db = new Database(this.DB_PATH);

			// Enable WAL mode for better concurrency
			this.db.run("PRAGMA journal_mode = WAL");
			this.db.run("PRAGMA foreign_keys = ON");

			// Create telegram_users table
			this.db.run(`
        CREATE TABLE IF NOT EXISTS telegram_users (
          telegram_id INTEGER PRIMARY KEY,
          username TEXT,
          first_name TEXT,
          role TEXT DEFAULT 'user',
          created_at INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          CHECK(role IN ('admin', 'user'))
        )
      `);

			// Create index for role-based queries
			this.db.run(
				"CREATE INDEX IF NOT EXISTS idx_telegram_users_role ON telegram_users(role)",
			);

			console.log("[TelegramAuth] Database initialized");
		} catch (err) {
			console.error("[TelegramAuth] Failed to initialize database:", err);
			this.db = null;
		}
	}

	// Load users from database into cache
	private loadUsers(): void {
		if (!this.db) {
			console.log("[TelegramAuth] No database available, starting fresh");
			return;
		}

		try {
			const users = this.db
				.query(
					"SELECT telegram_id, username, first_name, role, created_at, last_seen FROM telegram_users",
				)
				.all() as Array<{
				telegram_id: number;
				username: string | null;
				first_name: string | null;
				role: string;
				created_at: number;
				last_seen: number;
			}>;

			for (const user of users) {
				this.usersCache.set(user.telegram_id, {
					telegramId: user.telegram_id,
					username: user.username || undefined,
					firstName: user.first_name || undefined,
					role: user.role as "admin" | "user",
					createdAt: user.created_at,
					lastSeen: user.last_seen,
				});
			}

			console.log(`[TelegramAuth] Loaded ${users.length} users from database`);
		} catch (err) {
			console.error("[TelegramAuth] Failed to load users from database:", err);
		}
	}

	// Initialize admin user from environment variable
	private initializeAdminUser(): void {
		const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;

		if (!adminTelegramId) {
			console.warn(
				"[TelegramAuth] ADMIN_TELEGRAM_ID not set - no admin user initialized",
			);
			return;
		}

		const adminId = Number.parseInt(adminTelegramId, 10);
		if (Number.isNaN(adminId)) {
			console.error(
				"[TelegramAuth] Invalid ADMIN_TELEGRAM_ID - must be a number",
			);
			return;
		}

		// Check if admin already exists
		const existingAdmin = this.usersCache.get(adminId);
		if (existingAdmin) {
			// Update role to admin if not already
			if (existingAdmin.role !== "admin") {
				this.updateUserRole(adminId, "admin");
				console.log(`[TelegramAuth] Updated user ${adminId} to admin role`);
			} else {
				console.log(`[TelegramAuth] Admin user already exists: ${adminId}`);
			}
			return;
		}

		// Create new admin user
		const now = Date.now();
		const adminUser: TelegramUser = {
			telegramId: adminId,
			firstName: "Admin",
			role: "admin",
			createdAt: now,
			lastSeen: now,
		};

		this.addUserToDatabase(adminUser);
		this.usersCache.set(adminId, adminUser);
		console.log(`[TelegramAuth] Created admin user: ${adminId}`);
	}

	// Re-check and initialize admin user (called when settings are updated)
	reinitializeAdminUser(): void {
		const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
		if (!adminTelegramId) {
			console.log(
				"[TelegramAuth] ADMIN_TELEGRAM_ID still not set, skipping re-initialization",
			);
			return;
		}
		console.log(
			`[TelegramAuth] Re-initializing admin user with ID: ${adminTelegramId}`,
		);
		this.initializeAdminUser();
	}

	// Add user to database
	private addUserToDatabase(user: TelegramUser): void {
		if (!this.db) {
			console.error("[TelegramAuth] No database available");
			return;
		}

		try {
			this.db.run(
				`INSERT INTO telegram_users (telegram_id, username, first_name, role, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)`,
				[
					user.telegramId,
					user.username || null,
					user.firstName || null,
					user.role,
					user.createdAt,
					user.lastSeen,
				],
			);
		} catch (err) {
			console.error("[TelegramAuth] Failed to add user to database:", err);
		}
	}

	// Check if user is authorized
	isUserAuthorized(telegramId: number): boolean {
		return this.usersCache.has(telegramId);
	}

	// Get user by Telegram ID
	getUser(telegramId: number): TelegramUser | null {
		return this.usersCache.get(telegramId) || null;
	}

	// Check if user is admin
	isAdmin(telegramId: number): boolean {
		const user = this.usersCache.get(telegramId);
		return user?.role === "admin";
	}

	// Add new user (admin only)
	addUser(user: Omit<TelegramUser, "createdAt" | "lastSeen">): void {
		const now = Date.now();
		const newUser: TelegramUser = {
			...user,
			createdAt: now,
			lastSeen: now,
		};

		this.addUserToDatabase(newUser);
		this.usersCache.set(user.telegramId, newUser);
		console.log(
			`[TelegramAuth] Added user: ${user.telegramId} (${user.firstName})`,
		);
	}

	// Remove user (admin only)
	removeUser(telegramId: number): void {
		this.usersCache.delete(telegramId);

		if (this.db) {
			try {
				this.db.run("DELETE FROM telegram_users WHERE telegram_id = ?", [
					telegramId,
				]);
				console.log(`[TelegramAuth] Removed user: ${telegramId}`);
			} catch (err) {
				console.error(
					"[TelegramAuth] Failed to remove user from database:",
					err,
				);
			}
		}
	}

	// Update user role (admin only)
	updateUserRole(telegramId: number, role: "admin" | "user"): void {
		const user = this.usersCache.get(telegramId);
		if (!user) {
			console.warn(`[TelegramAuth] User ${telegramId} not found`);
			return;
		}

		user.role = role;
		this.usersCache.set(telegramId, user);

		if (this.db) {
			try {
				this.db.run(
					"UPDATE telegram_users SET role = ? WHERE telegram_id = ?",
					[role, telegramId],
				);
				console.log(
					`[TelegramAuth] Updated user ${telegramId} role to ${role}`,
				);
			} catch (err) {
				console.error(
					"[TelegramAuth] Failed to update user role in database:",
					err,
				);
			}
		}
	}

	// Update user's last seen timestamp
	updateLastSeen(telegramId: number): void {
		const user = this.usersCache.get(telegramId);
		if (!user) {
			return;
		}

		const now = Date.now();
		user.lastSeen = now;
		this.usersCache.set(telegramId, user);

		if (this.db) {
			try {
				this.db.run(
					"UPDATE telegram_users SET last_seen = ? WHERE telegram_id = ?",
					[now, telegramId],
				);
			} catch (err) {
				console.error(
					"[TelegramAuth] Failed to update last_seen in database:",
					err,
				);
			}
		}
	}

	// Get all users (admin only)
	getAllUsers(): TelegramUser[] {
		return Array.from(this.usersCache.values());
	}

	// Get all admin users
	getAdminUsers(): TelegramUser[] {
		return Array.from(this.usersCache.values()).filter(
			(u) => u.role === "admin",
		);
	}

	// Get count of users
	getUserCount(): number {
		return this.usersCache.size;
	}

	// Shutdown and close database connection
	shutdown(): void {
		if (this.db) {
			try {
				this.db.close();
				this.db = null;
				console.log("[TelegramAuth] Database closed");
			} catch (err) {
				console.error("[TelegramAuth] Error closing database:", err);
			}
		}
	}
}

// Global auth store singleton
export const telegramAuthStore = new TelegramAuthStore();

// Convenience functions
export function isUserAuthorized(telegramId: number): boolean {
	return telegramAuthStore.isUserAuthorized(telegramId);
}

export function getUser(telegramId: number): TelegramUser | null {
	return telegramAuthStore.getUser(telegramId);
}

export function isAdmin(telegramId: number): boolean {
	return telegramAuthStore.isAdmin(telegramId);
}

export function addUser(
	user: Omit<TelegramUser, "createdAt" | "lastSeen">,
): void {
	telegramAuthStore.addUser(user);
}

export function removeUser(telegramId: number): void {
	telegramAuthStore.removeUser(telegramId);
}

export function updateUserRole(
	telegramId: number,
	role: "admin" | "user",
): void {
	telegramAuthStore.updateUserRole(telegramId, role);
}

export function updateLastSeen(telegramId: number): void {
	telegramAuthStore.updateLastSeen(telegramId);
}

export function getAllUsers(): TelegramUser[] {
	return telegramAuthStore.getAllUsers();
}

export function reinitializeAdminUser(): void {
	telegramAuthStore.reinitializeAdminUser();
}
