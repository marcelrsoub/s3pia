/**
 * Environment Variable Management
 *
 * Uses /app/ws/config/.env file for storage.
 * Hot-reloads into process.env on every write.
 */

const CONFIG_DIR = "/app/ws/config";
const ENV_FILE = `${CONFIG_DIR}/.env`;

// Track which keys are secrets (never expose in prompts)
const SECRET_KEYS = new Set([
	"TELEGRAM_BOT_TOKEN",
	"ZAI_API_KEY",
	"OPENROUTER_API_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GROQ_API_KEY",
	"GEMINI_API_KEY",
	"TAVILY_API_KEY",
	"FAL_AI_API_KEY",
	// Keys ending in _API_KEY or _TOKEN are treated as secret
]);

/**
 * Check if a key is a secret
 */
function isSecret(key: string): boolean {
	return (
		SECRET_KEYS.has(key) || key.endsWith("_API_KEY") || key.endsWith("_TOKEN")
	);
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
	// Create directory unconditionally using mkdir -p (idempotent)
	try {
		await Bun.$`mkdir -p ${CONFIG_DIR}`;
	} catch {
		// Ignore error, directory might already exist
	}
}

/**
 * Represents a parsed line from a .env file
 */
interface EnvLine {
	type: "variable" | "comment" | "empty";
	key?: string;
	value?: string;
	inlineComment?: string;
	originalLine?: string; // Preserve exact formatting
}

/**
 * Parse a single .env value, handling quotes and escapes
 */
function parseEnvValue(value: string): string {
	// Trim whitespace
	value = value.trim();

	// Handle empty value
	if (!value) return "";

	// Handle double-quoted strings
	if (value.startsWith('"') && value.endsWith('"')) {
		// Remove surrounding quotes and process escape sequences in a single pass
		const inner = value.slice(1, -1);
		let result = "";
		let i = 0;

		while (i < inner.length) {
			if (inner[i] === "\\" && i + 1 < inner.length) {
				// Escape sequence
				const next = inner[i + 1];
				switch (next) {
					case "n":
						result += "\n";
						i += 2;
						break;
					case "r":
						result += "\r";
						i += 2;
						break;
					case "t":
						result += "\t";
						i += 2;
						break;
					case "f":
						result += "\f";
						i += 2;
						break;
					case '"':
						result += '"';
						i += 2;
						break;
					case "\\":
						result += "\\";
						i += 2;
						break;
					default:
						// Unknown escape, treat as literal characters
						result += inner[i];
						i += 1;
						break;
				}
			} else {
				// Regular character
				result += inner[i];
				i += 1;
			}
		}

		return result;
	}

	// Handle single-quoted strings (no escape processing inside single quotes)
	if (value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}

	// Unquoted value - trim and return
	return value;
}

/**
 * Quote a value if needed for safe .env output
 * Handles: spaces, tabs, newlines, #, ", ', $, backticks, and leading/trailing whitespace
 */
function quoteEnvValue(value: string): string {
	if (!value) return '""';

	// Check if value needs quoting
	const needsQuoting =
		value.includes(" ") ||
		value.includes("\t") ||
		value.includes("\n") ||
		value.includes("#") ||
		value.includes('"') ||
		value.includes("'") ||
		value.includes("$") ||
		value.includes("`") ||
		value.startsWith("=") ||
		value.endsWith(" ");

	if (!needsQuoting) {
		return value;
	}

	// Use double quotes with escaping
	// Escape: backslash, double quote, newline, carriage return, tab, formfeed, dollar sign, backtick
	const quoted = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")
		.replace(/\f/g, "\\f")
		.replace(/\$/g, "\\$")
		.replace(/`/g, "\\`");

	return `"${quoted}"`;
}

/**
 * Parse a single line from .env file
 */
function parseEnvLine(line: string): EnvLine | null {
	const trimmed = line.trim();

	// Empty line
	if (!trimmed) {
		return { type: "empty", originalLine: line };
	}

	// Full-line comment
	if (trimmed.startsWith("#")) {
		return { type: "comment", originalLine: line };
	}

	// Try to parse as KEY=VALUE
	// Find first = that's not inside quotes
	let i = 0;

	// Skip leading whitespace in key
	while (i < line.length && /\s/.test(line[i])) i++;

	// Find the key
	const keyStart = i;
	while (i < line.length && line[i] !== "=" && !/\s/.test(line[i])) i++;
	const key = line.slice(keyStart, i);

	// Skip whitespace after key
	while (i < line.length && /\s/.test(line[i])) i++;

	// Expect =
	if (i >= line.length || line[i] !== "=") {
		// Not a valid variable line, treat as comment/preserve
		return { type: "comment", originalLine: line };
	}
	i++; // Skip =

	// Skip whitespace after =
	while (i < line.length && /\s/.test(line[i])) i++;

	// Extract value (handling quoted values with = inside)
	const valueStart = i;
	let valueEnd = i;

	if (i < line.length && (line[i] === '"' || line[i] === "'")) {
		// Quoted value
		const quote = line[i];
		i++; // Skip opening quote
		valueEnd = i;

		while (i < line.length) {
			if (line[i] === "\\" && i + 1 < line.length) {
				// Skip escaped character
				i += 2;
				valueEnd = i;
			} else if (line[i] === quote) {
				// Closing quote
				valueEnd = i + 1;
				i++;
				break;
			} else {
				i++;
				valueEnd = i;
			}
		}
	} else {
		// Unquoted value - read until # or end of line
		while (i < line.length && line[i] !== "#") {
			i++;
			valueEnd = i;
		}
	}

	const rawValue = line.slice(valueStart, valueEnd);

	// Check for inline comment
	let inlineComment: string | undefined;
	while (i < line.length && /\s/.test(line[i])) i++;
	if (i < line.length && line[i] === "#") {
		inlineComment = line.slice(i).trim();
	}

	return {
		type: "variable",
		key: key,
		value: parseEnvValue(rawValue),
		inlineComment,
		originalLine: line,
	};
}

/**
 * Parse .env file content into key-value pairs
 */
function parseEnvFile(content: string): Map<string, string> {
	const env = new Map<string, string>();
	for (const line of content.split("\n")) {
		const parsed = parseEnvLine(line);
		if (
			parsed?.type === "variable" &&
			parsed.key &&
			parsed.value !== undefined
		) {
			env.set(parsed.key, parsed.value);
		}
	}
	return env;
}

/**
 * Parse .env file content into structured lines (preserves comments/formatting)
 */
function parseEnvFileWithStructure(content: string): EnvLine[] {
	const lines: EnvLine[] = [];
	for (const line of content.split("\n")) {
		const parsed = parseEnvLine(line);
		if (parsed) {
			lines.push(parsed);
		} else {
			// Shouldn't happen, but preserve line as-is
			lines.push({ type: "comment", originalLine: line });
		}
	}
	return lines;
}

/**
 * Reconstruct .env file content from structured lines
 */
function reconstructEnvFile(lines: EnvLine[]): string {
	const output: string[] = [];

	for (const line of lines) {
		if (line.type === "empty") {
			output.push("");
		} else if (line.type === "comment") {
			output.push(line.originalLine || "");
		} else if (line.type === "variable") {
			const valueStr = quoteEnvValue(line.value || "");
			const comment = line.inlineComment ? ` ${line.inlineComment}` : "";
			output.push(`${line.key}=${valueStr}${comment}`);
		}
	}

	return output.join("\n");
}

/**
 * Load .env file into process.env
 * Called on startup and after any write operation
 */
export async function loadEnvFile(): Promise<void> {
	try {
		await ensureConfigDir();

		const file = Bun.file(ENV_FILE);
		if (!(await file.exists())) {
			console.log("[Env] No .env file found, starting fresh");
			return;
		}

		const content = await file.text();
		const env = parseEnvFile(content);

		for (const [key, value] of env.entries()) {
			process.env[key] = value;
		}

		console.log(`[Env] Loaded ${env.size} variables from ${ENV_FILE}`);
	} catch (err) {
		console.error("[Env] Failed to load .env file:", err);
	}
}

/**
 * Migrate settings from database to .env file (one-time migration)
 * Called on startup to handle upgrades from the old database-based settings
 */
export async function migrateSettingsFromDatabase(): Promise<void> {
	try {
		await ensureConfigDir();

		// Check if .env file already has content
		const file = Bun.file(ENV_FILE);
		const existingContent = (await file.exists()) ? await file.text() : "";
		const existingEnv = parseEnvFile(existingContent);

		// Check if we have non-empty values already
		const hasValues = Array.from(existingEnv.values()).some(
			(v) => v.trim() !== "",
		);
		if (hasValues) {
			return; // Already migrated or user has set values
		}

		// Try to import database and migrate
		const dbPath = "/app/ws/s3pia.db";
		const dbFile = Bun.file(dbPath);
		if (!(await dbFile.exists())) {
			return; // No database to migrate from
		}

		// Use dynamic import to avoid circular dependency
		const { Database } = await import("bun:sqlite");
		const db = new Database(dbPath);

		try {
			const rows = db
				.query(
					"SELECT key, value FROM settings WHERE value IS NOT NULL AND value != ''",
				)
				.all() as Array<{ key: string; value: string }>;

			if (rows.length === 0) {
				return; // No settings to migrate
			}

			// Build new .env content
			const lines = [
				"# SepiaBot Configuration",
				"# Migrated from database settings",
				"",
			];

			for (const row of rows) {
				lines.push(`${row.key}=${row.value}`);
			}
			lines.push("");

			await Bun.write(ENV_FILE, lines.join("\n"));
			console.log(
				`[Env] Migrated ${rows.length} settings from database to .env file`,
			);
		} finally {
			db.close();
		}
	} catch (err) {
		// Migration failure is not critical - just log and continue
		console.log(
			"[Env] Migration skipped:",
			err instanceof Error ? err.message : String(err),
		);
	}
}

/**
 * Get environment variable value
 * Returns null if not set
 */
export function getEnvVar(key: string): string | null {
	return process.env[key] ?? null;
}

/**
 * Get all environment variables as a Record
 * Returns all key-value pairs from process.env that are in the .env file
 */
export async function getAllEnvVars(): Promise<Record<string, string>> {
	await ensureConfigDir();

	const file = Bun.file(ENV_FILE);
	if (!(await file.exists())) {
		return {};
	}

	const content = await file.text();
	const env = parseEnvFile(content);

	return Object.fromEntries(env.entries());
}

/**
 * Get all environment variables with metadata
 * Returns array of { key, value, isSecret }
 */
export async function getAllEnvVarsWithMetadata(): Promise<
	Array<{ key: string; value: string; isSecret: boolean }>
> {
	await ensureConfigDir();

	const file = Bun.file(ENV_FILE);
	if (!(await file.exists())) {
		return [];
	}

	const content = await file.text();
	const env = parseEnvFile(content);

	return Array.from(env.entries()).map(([key, value]) => ({
		key,
		value,
		isSecret: isSecret(key),
	}));
}

/**
 * Get summary of all environment variables
 * Returns array of { key, configured, isSecret }
 * Used by agent context to show what's available
 * configured: true if value is non-empty, false if empty
 */
export async function getEnvSummary(): Promise<
	Array<{ key: string; configured: boolean; isSecret: boolean }>
> {
	try {
		await ensureConfigDir();

		const file = Bun.file(ENV_FILE);
		if (!(await file.exists())) {
			return [];
		}

		const content = await file.text();
		const env = parseEnvFile(content);

		return Array.from(env.entries()).map(([key, value]) => ({
			key,
			configured: value.length > 0,
			isSecret: isSecret(key),
		}));
	} catch (err) {
		console.error("[Env] Failed to get summary:", err);
		return [];
	}
}

/**
 * Set an environment variable
 * Creates or updates the key in .env file and syncs to process.env
 * Preserves comments and formatting
 */
export async function setEnvVar(
	key: string,
	value: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		await ensureConfigDir();

		// Validate key format (uppercase, underscores)
		if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
			return {
				success: false,
				error: `Invalid env var name: ${key}. Use uppercase letters and underscores only.`,
			};
		}

		// Read existing content
		let existingContent = "";
		const file = Bun.file(ENV_FILE);
		if (await file.exists()) {
			existingContent = await file.text();
		}

		// Parse existing file structure (preserves comments, formatting)
		const lines = parseEnvFileWithStructure(existingContent);

		// Check if key already exists in the file
		let keyFound = false;
		for (const line of lines) {
			if (line.type === "variable" && line.key === key) {
				// Update existing line, preserving inline comment
				line.value = value;
				keyFound = true;
				break;
			}
		}

		// If key not found, add new line at the end
		if (!keyFound) {
			// Add a blank line before new variable if file doesn't end with one
			// Check both last line type and if content ends with newline
			const needsSpacing =
				lines.length > 0 &&
				lines[lines.length - 1].type !== "empty" &&
				!existingContent.endsWith("\n");
			if (needsSpacing) {
				lines.push({ type: "empty" });
			}
			lines.push({
				type: "variable",
				key,
				value,
			});
		}

		// Reconstruct file content preserving formatting
		const newContent = reconstructEnvFile(lines);

		// Write atomically (Bun handles this)
		await Bun.write(ENV_FILE, newContent);

		// Sync to process.env
		process.env[key] = value;

		console.log(`[Env] Set ${key} = ${isSecret(key) ? "***" : value}`);
		return { success: true };
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		console.error("[Env] Failed to set env var:", err);
		return { success: false, error };
	}
}

/**
 * Delete an environment variable
 * Removes from .env file and process.env
 * Preserves comments and formatting
 */
export async function deleteEnvVar(
	key: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		await ensureConfigDir();

		const file = Bun.file(ENV_FILE);
		if (!(await file.exists())) {
			return { success: false, error: "No .env file found" };
		}

		const content = await file.text();
		const lines = parseEnvFileWithStructure(content);

		// Check if key exists
		const keyExists = lines.some(
			(line) => line.type === "variable" && line.key === key,
		);
		if (!keyExists) {
			return { success: false, error: `Key ${key} not found` };
		}

		// Filter out the line with the key
		const filteredLines = lines.filter(
			(line) => !(line.type === "variable" && line.key === key),
		);

		// Reconstruct file content
		const newContent = reconstructEnvFile(filteredLines);

		// Write atomically
		await Bun.write(ENV_FILE, newContent);

		// Remove from process.env
		delete process.env[key];

		console.log(`[Env] Deleted ${key}`);
		return { success: true };
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		console.error("[Env] Failed to delete env var:", err);
		return { success: false, error };
	}
}

/**
 * Get the raw .env file content for editing
 * Used by the frontend env editor
 */
export async function getEnvFileContent(): Promise<string> {
	await ensureConfigDir();

	const file = Bun.file(ENV_FILE);
	if (!(await file.exists())) {
		// Return empty content if file doesn't exist yet
		return "";
	}

	return await file.text();
}

/**
 * Check if required environment variables are configured
 * Required: AI_PROVIDER, AI_MODEL
 */
export function isEnvConfigured(): boolean {
	const provider = process.env.AI_PROVIDER;
	const model = process.env.AI_MODEL;
	return !!provider && !!model;
}

/**
 * Get configuration status
 * Returns { configured, missingRequired, canStart }
 */
export function getEnvStatus(): {
	configured: boolean;
	missingRequired: string[];
	canStart: boolean;
} {
	const provider = process.env.AI_PROVIDER;
	const model = process.env.AI_MODEL;
	const missingRequired: string[] = [];

	if (!provider) missingRequired.push("AI_PROVIDER");
	if (!model) missingRequired.push("AI_MODEL");

	return {
		configured: missingRequired.length === 0,
		missingRequired,
		canStart: missingRequired.length === 0,
	};
}

/**
 * Validate environment configuration
 */
export function validateEnv(): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	const status = getEnvStatus();

	if (status.missingRequired.length > 0) {
		errors.push(
			`Missing required settings: ${status.missingRequired.join(", ")}`,
		);
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Update multiple environment variables at once
 */
export async function updateManyEnvVars(
	settings: Record<string, string>,
): Promise<void> {
	for (const [key, value] of Object.entries(settings)) {
		await setEnvVar(key, value);
	}
}

/**
 * Settings schema for UI
 * Static definition of available settings
 */
export function getEnvSchema(): Record<
	string,
	Array<{
		key: string;
		label: string;
		description: string;
		required: boolean;
		isSecret: boolean;
		placeholder?: string;
		defaultValue?: string;
	}>
> {
	return {
		telegram: [
			{
				key: "TELEGRAM_ENABLED",
				label: "Enable Telegram",
				description: "Toggle Telegram bot on/off",
				required: false,
				isSecret: false,
				defaultValue: "true",
			},
			{
				key: "TELEGRAM_BOT_TOKEN",
				label: "Bot Token",
				description: "Your Telegram bot token from @BotFather",
				required: true,
				isSecret: true,
				placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
			},
			{
				key: "ADMIN_TELEGRAM_ID",
				label: "Admin Telegram ID",
				description: "Your Telegram user ID (get from @userinfobot)",
				required: true,
				isSecret: false,
				placeholder: "123456789",
			},
		],
		ai: [
			{
				key: "AI_PROVIDER",
				label: "AI Provider",
				description: "Select AI provider (zai or openrouter)",
				required: true,
				isSecret: false,
				defaultValue: "zai",
			},
			{
				key: "AI_MODEL",
				label: "AI Model",
				description: "The model identifier",
				required: true,
				isSecret: false,
			},
			{
				key: "ZAI_API_KEY",
				label: "Z.AI API Key",
				description: "Your Z.AI API key",
				required: true,
				isSecret: true,
			},
			{
				key: "OPENROUTER_API_KEY",
				label: "OpenRouter API Key",
				description: "Your OpenRouter API key",
				required: false,
				isSecret: true,
			},
			{
				key: "TAVILY_API_KEY",
				label: "Tavily API Key",
				description: "For web search functionality",
				required: false,
				isSecret: true,
			},
		],
		server: [
			{
				key: "PORT",
				label: "Server Port",
				description: "Port for the HTTP server",
				required: false,
				isSecret: false,
				defaultValue: "3210",
			},
		],
	};
}
