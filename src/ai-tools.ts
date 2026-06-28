// @ts-nocheck - Type inference issues with AI SDK tool() in strict mode
/**
 * AI SDK Tool Definitions
 *
 * Converts our tool implementations to AI SDK format with Zod schemas.
 * Used by the agent for native function calling.
 */

import { resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { createLinkedAbortController } from "./abort.js";
import { getApiKey } from "./api-keys.js";
import {
	conversationStore,
	type Message,
	TELEGRAM_CONVERSATION_ID,
} from "./conversation.js";
import { deleteEnvVar, getEnvSummary, getEnvVar, setEnvVar } from "./env.js";
import { estimateTokens, getCachedActiveModelBudget } from "./openrouter.js";
import { clearWorkspaceContextCache } from "./prompts.js";
import { getSkills } from "./skills.js";
import {
	buildWorkspaceAttachment,
	normalizeWorkspaceFilePath,
	sendTelegramMessageToAdmin,
} from "./telegram-client.js";
import { workspacePath } from "./workspace.js";

const WORKSPACE = workspacePath();

async function getChunkCharacterBudget(): Promise<number> {
	const budget = getCachedActiveModelBudget();
	return Math.max(4_000, Math.min(24_000, budget.toolReserveTokens * 4));
}

async function fetchWithLinkedAbort(
	input: string,
	init: RequestInit,
	abortSignal?: AbortSignal,
	timeoutMs = 15_000,
	timeoutReason = "Request timed out",
): Promise<Response> {
	const linked = createLinkedAbortController({
		abortSignal,
		timeoutMs,
		abortReason: "Request aborted",
		timeoutReason,
	});

	try {
		return await fetch(input, {
			...init,
			signal: linked.controller.signal,
		});
	} finally {
		linked.cleanup();
	}
}

interface ChunkedTextResult {
	kind: "chunked_text";
	label: string;
	preview: string;
	charsReturned: number;
	totalChars: number;
	truncated: boolean;
	nextOffset: number | null;
	offset: number;
	remainingChars: number;
	startLine?: number;
	endLine?: number;
	remainingLines?: number;
	lineWindowApplied?: boolean;
	message?: string;
}

interface PromptMessage {
	role: "user" | "assistant";
	content: string;
}

export interface ThreadStateStore {
	get(conversationId: string):
		| {
				metadata?: {
					preferredLanguage?: string;
					lastIntakeKind?: string;
					lastIntakeNextStep?: string;
					lastIntakeGoal?: string;
					activeRunId?: string;
					activeRunSource?: string;
					activeRunStatus?: string;
					activeRunPreview?: string;
					activeRunQuestion?: string;
					activeRunStartedAt?: number;
					activeRunUpdatedAt?: number;
				};
				lastActivity: number;
		  }
		| undefined;
	getRecentMessages(conversationId: string, limit: number): Message[];
	getMessagesSince(conversationId: string, sinceTimestamp: number): Message[];
}

export function compactText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const headLength = Math.max(0, Math.floor(maxChars * 0.65));
	const tailLength = Math.max(0, maxChars - headLength - 64);
	const head = text.slice(0, headLength).trimEnd();
	const tail = text
		.slice(Math.max(headLength, text.length - tailLength))
		.trimStart();
	return `${head}\n\n[...omitted ${text.length - head.length - tail.length} chars...]\n\n${tail}`;
}

export function buildThreadSnapshot(messages: Message[]): string | null {
	if (messages.length === 0) return null;
	const recent = messages.slice(-12);
	const lastUser = [...recent].reverse().find((msg) => msg.role === "user");
	const assistantSummaries = recent
		.filter((msg) => msg.role === "assistant")
		.slice(-3)
		.map((msg) => compactText(msg.content, 280));
	const fileReferences = recent
		.flatMap((msg) => msg.files?.map((file) => file.path) ?? [])
		.slice(-5);

	const lines = [
		lastUser
			? `Latest user context:\n${compactText(lastUser.content, 600)}`
			: null,
		assistantSummaries.length > 0
			? `Recent assistant context:\n${assistantSummaries
					.map((summary, index) => `${index + 1}. ${summary}`)
					.join("\n")}`
			: null,
		fileReferences.length > 0
			? `Referenced files:\n${fileReferences.map((path) => `- ${path}`).join("\n")}`
			: null,
	].filter(Boolean);

	return lines.length > 0 ? lines.join("\n\n") : null;
}

export function takeMessagesWithinBudget(
	messages: PromptMessage[],
	tokenBudget: number,
): { messages: PromptMessage[]; droppedCount: number } {
	const selected: PromptMessage[] = [];
	let usedTokens = 0;
	let droppedCount = 0;

	for (const message of messages) {
		const cost = estimateTokens(message.content) + 16;
		if (selected.length > 0 && usedTokens + cost > tokenBudget) {
			droppedCount++;
			continue;
		}

		selected.push(message);
		usedTokens += cost;
	}

	return { messages: selected, droppedCount };
}

export function buildChunkedTextResult(
	text: string,
	maxChars: number,
	options: {
		label: string;
		offset?: number;
		totalLines?: number;
		startLine?: number;
		endLine?: number;
		lineWindowApplied?: boolean;
	},
): ChunkedTextResult {
	const offset = options.offset ?? 0;
	const slice = text.slice(offset, offset + maxChars);
	const nextOffset =
		offset + slice.length < text.length ? offset + slice.length : null;

	return {
		kind: "chunked_text",
		label: options.label,
		preview: slice,
		charsReturned: slice.length,
		totalChars: text.length,
		truncated: nextOffset !== null || offset > 0,
		nextOffset,
		offset,
		remainingChars: Math.max(0, text.length - (offset + slice.length)),
		startLine: options.startLine,
		endLine: options.endLine,
		remainingLines:
			options.totalLines && options.endLine
				? Math.max(0, options.totalLines - options.endLine)
				: undefined,
		lineWindowApplied: options.lineWindowApplied,
		message:
			nextOffset !== null || offset > 0
				? `Content exceeded the current model budget. Read the next chunk with offset ${nextOffset ?? offset + slice.length}.`
				: undefined,
	};
}

function compactThreadText(text: string, maxChars = 180): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function summarizeThreadMessage(message: Message): ThreadStateMessage {
	return {
		role: message.role,
		timestamp: message.timestamp,
		source: message.source,
		preview: compactThreadText(message.content),
	};
}

interface ThreadStateMessage {
	role: Message["role"];
	timestamp: number;
	source?: Message["source"];
	preview: string;
}

interface ThreadStateSnapshot {
	conversationId: string;
	checkpointAt: number;
	metadata: {
		preferredLanguage?: string;
		lastIntakeKind?: string;
		lastIntakeNextStep?: string;
		lastIntakeGoal?: string;
		activeRunId?: string;
		activeRunSource?: string;
		activeRunStatus?: string;
		activeRunPreview?: string;
		activeRunQuestion?: string;
		activeRunStartedAt?: number;
		activeRunUpdatedAt?: number;
	};
	activeRun: {
		id?: string;
		source?: string;
		status: string;
		preview?: string;
		question?: string;
		startedAt?: number;
		updatedAt?: number;
	} | null;
	recentMessages: ThreadStateMessage[];
	newUserUpdates: number;
	latestUserMessage: ThreadStateMessage | null;
	summary: string;
}

export function buildThreadState(
	conversationId = TELEGRAM_CONVERSATION_ID,
	sinceTimestamp?: number,
	limit = 8,
	store: ThreadStateStore = conversationStore,
): ThreadStateSnapshot {
	const conversation = store.get(conversationId);
	const metadata = conversation?.metadata || {};
	const activeRunStatus =
		metadata.activeRunStatus === "running" ||
		metadata.activeRunStatus === "blocked"
			? metadata.activeRunStatus
			: undefined;
	const checkpointAt =
		sinceTimestamp ??
		metadata.activeRunUpdatedAt ??
		metadata.activeRunStartedAt ??
		conversation?.lastActivity ??
		0;
	const activeRun = activeRunStatus
		? {
				id: metadata.activeRunId,
				source: metadata.activeRunSource,
				status: activeRunStatus,
				preview: metadata.activeRunPreview,
				question: metadata.activeRunQuestion,
				startedAt: metadata.activeRunStartedAt,
				updatedAt: metadata.activeRunUpdatedAt,
			}
		: null;

	const sourceMessages =
		sinceTimestamp !== undefined
			? store.getMessagesSince(conversationId, checkpointAt)
			: store.getRecentMessages(conversationId, limit);
	const recentMessages = sourceMessages
		.slice(-Math.max(1, limit))
		.map(summarizeThreadMessage);
	const userMessages = recentMessages.filter(
		(message) => message.role === "user",
	);
	const latestUserMessage = userMessages.at(-1) || null;
	const newUserUpdates = userMessages.length;

	const summaryParts = [
		activeRun
			? `Live run ${activeRun.status}: ${activeRun.preview || "unknown"}`
			: "No active run.",
		newUserUpdates > 0
			? `Recent user updates: ${newUserUpdates}`
			: "No recent user updates.",
		latestUserMessage
			? `Latest user message: ${latestUserMessage.preview}`
			: null,
	].filter(Boolean);

	return {
		conversationId,
		checkpointAt,
		metadata: {
			preferredLanguage: metadata.preferredLanguage,
			lastIntakeKind: metadata.lastIntakeKind,
			lastIntakeNextStep: metadata.lastIntakeNextStep,
			lastIntakeGoal: metadata.lastIntakeGoal,
			activeRunId: metadata.activeRunId,
			activeRunSource: metadata.activeRunSource,
			activeRunStatus: activeRunStatus,
			activeRunPreview: metadata.activeRunPreview,
			activeRunQuestion: metadata.activeRunQuestion,
			activeRunStartedAt: metadata.activeRunStartedAt,
			activeRunUpdatedAt: metadata.activeRunUpdatedAt,
		},
		activeRun,
		recentMessages,
		newUserUpdates,
		latestUserMessage,
		summary: summaryParts.join(" "),
	};
}

// Tool definitions using AI SDK's tool() function
export const aiTools = {
	web_search: tool({
		description: "Search the web for information using Tavily API",
		inputSchema: z.object({
			query: z.string().describe("The search query"),
		}),
		execute: async ({ query }, { abortSignal } = {}) => {
			if (!query) {
				return "Error: query parameter is required. Provide a search term.";
			}
			console.log(`[web_search] Searching for: "${query}"`);
			const apiKey = getApiKey("tavily");
			if (!apiKey) {
				return "Error: TAVILY_API_KEY not configured";
			}

			try {
				const response = await fetchWithLinkedAbort(
					"https://api.tavily.com/search",
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							api_key: apiKey,
							query,
							max_results: 10,
							search_depth: "basic",
							include_answer: true,
							include_raw_content: false,
						}),
					},
					abortSignal,
					20_000,
					"Tavily search timed out",
				);

				if (!response.ok) {
					const errorText = await response.text();
					return `Error: Tavily API error: ${response.status} ${errorText}`;
				}

				const data = (await response.json()) as {
					answer?: string;
					results?: Array<{ title: string; url: string; content: string }>;
				};

				let output = "";
				if (data.answer) {
					output += `## Summary\n${data.answer}\n\n`;
				}
				output += `## Search Results\n\n`;
				if (data.results && data.results.length > 0) {
					for (const result of data.results) {
						output += `### ${result.title}\nURL: ${result.url}\n${result.content?.slice(0, 300) || ""}...\n\n`;
					}
				}
				return output || "No results found.";
			} catch (err) {
				if (abortSignal?.aborted) {
					throw err;
				}
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),

	read_file: tool({
		description: "Read the contents of a file",
		inputSchema: z.object({
			path: z.string().describe("Absolute path to the file to read"),
			offset: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Character offset for chunked reads"),
			length: z
				.number()
				.int()
				.min(1)
				.max(50000)
				.optional()
				.describe("Maximum characters to return"),
			startLine: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("1-based starting line for a line-range read"),
			endLine: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("1-based ending line for a line-range read"),
		}),
		execute: async ({ path, offset = 0, length, startLine, endLine }) => {
			console.log(`[read_file] Reading: ${path}`);
			try {
				const normalizedPath = normalizeWorkspaceFilePath(path);
				if (!normalizedPath) {
					return `Error: Access denied outside workspace: ${path}`;
				}

				const file = Bun.file(normalizedPath);
				const exists = await file.exists();
				if (!exists) {
					return `Error: File not found: ${normalizedPath}`;
				}
				const text = await file.text();
				const maxChars = length ?? (await getChunkCharacterBudget());

				if (startLine || endLine) {
					const lines = text.split("\n");
					const safeStartLine = Math.max(1, startLine ?? 1);
					const safeEndLine = Math.max(safeStartLine, endLine ?? lines.length);
					const lineSlice = lines
						.slice(safeStartLine - 1, safeEndLine)
						.join("\n");
					return buildChunkedTextResult(lineSlice, maxChars, {
						label: normalizedPath,
						offset,
						startLine: safeStartLine,
						endLine: safeEndLine,
						totalLines: lines.length,
						lineWindowApplied: true,
					});
				}

				return buildChunkedTextResult(text, maxChars, {
					label: normalizedPath,
					offset,
				});
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),

	write_file: tool({
		description: "Create or overwrite a file with the given content",
		inputSchema: z.object({
			path: z.string().describe("Absolute path for the file"),
			content: z.string().describe("Content to write to the file"),
		}),
		execute: async ({ path, content }) => {
			console.log(`[write_file] Writing: ${path}`);
			try {
				const normalizedPath = normalizeWorkspaceFilePath(path);
				if (!normalizedPath) {
					return `Error: Access denied outside workspace: ${path}`;
				}

				await Bun.$`mkdir -p ${resolve(normalizedPath, "..")}`;
				await Bun.write(normalizedPath, content);

				if (normalizedPath.endsWith(".md")) {
					if (
						normalizedPath.endsWith("/IDENTITY.md") ||
						normalizedPath.endsWith("/SOUL.md") ||
						normalizedPath.endsWith("/USER.md") ||
						normalizedPath.endsWith("/BOOTSTRAP.md")
					) {
						clearWorkspaceContextCache();
					}

					if (normalizedPath.includes("/skills/")) {
						getSkills().clearCache();
					}
				}

				return `Successfully wrote ${content.length} bytes to ${normalizedPath}`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),

	edit_file: tool({
		description:
			"Edit a file by replacing occurrences of old_string with new_string",
		inputSchema: z.object({
			path: z.string().describe("File path"),
			old_string: z.string().describe("Text to find"),
			new_string: z.string().describe("Replacement text"),
		}),
		execute: async ({ path, old_string, new_string }) => {
			console.log(`[edit_file] Editing: ${path}`);
			try {
				const normalizedPath = normalizeWorkspaceFilePath(path);
				if (!normalizedPath) {
					return `Error: Access denied outside workspace: ${path}`;
				}

				const file = Bun.file(normalizedPath);
				const exists = await file.exists();
				if (!exists) {
					return `Error: File not found: ${normalizedPath}`;
				}

				const content = await file.text();
				if (!content.includes(old_string)) {
					return `Error: old_string not found in file: ${old_string.slice(0, 100)}...`;
				}

				const newContent = content.replace(old_string, new_string);
				await Bun.write(normalizedPath, newContent);

				if (
					normalizedPath.endsWith("/IDENTITY.md") ||
					normalizedPath.endsWith("/SOUL.md") ||
					normalizedPath.endsWith("/USER.md") ||
					normalizedPath.endsWith("/BOOTSTRAP.md")
				) {
					clearWorkspaceContextCache();
				}

				if (normalizedPath.includes("/skills/")) {
					getSkills().clearCache();
				}

				return `Successfully edited ${normalizedPath}`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),

	list_dir: tool({
		description: "List the contents of a directory",
		inputSchema: z.object({
			path: z.string().optional().describe("Directory path (default: /app/ws)"),
		}),
		execute: async ({ path = WORKSPACE }) => {
			console.log(`[list_dir] Listing: ${path}`);
			try {
				const normalizedPath = normalizeWorkspaceFilePath(path);
				if (!normalizedPath) {
					return `Error: Access denied outside workspace: ${path}`;
				}

				const result = await Bun.$`ls -F ${normalizedPath}`;
				return result.stdout.toString().trim();
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),

	exec: tool({
		description: "Execute a shell command in the workspace directory",
		inputSchema: z.object({
			command: z.string().describe("The shell command to execute"),
			offset: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Character offset for chunked reads of command output"),
		}),
		execute: async ({ command, offset = 0 }, { abortSignal } = {}) => {
			console.log(`[exec] Running: ${command}`);
			const TIMEOUT_MS = 140 * 1000; // 2 minutes 20 seconds
			let linked: ReturnType<typeof createLinkedAbortController> | null = null;

			try {
				linked = createLinkedAbortController({
					abortSignal,
					timeoutMs: TIMEOUT_MS,
					abortReason: "Command aborted",
					timeoutReason: "Command timed out",
				});

				const proc = Bun.spawn(["sh", "-c", command], {
					cwd: WORKSPACE,
					env: process.env,
					stdout: "pipe",
					stderr: "pipe",
					signal: linked.controller.signal,
				});

				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const exitCode = await proc.exited;

				linked.cleanup();

				const output =
					exitCode !== 0
						? `Error (exit ${exitCode}): ${stderr || stdout}`
						: stdout || stderr || "Command completed successfully";

				return buildChunkedTextResult(output, await getChunkCharacterBudget(), {
					label: `exec:${command}`,
					offset,
				});
			} catch (err) {
				if (abortSignal?.aborted) {
					throw err;
				}
				if (linked?.timedOut()) {
					return `Error: Command timed out after 140 seconds. Try breaking this into smaller steps.`;
				}
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			} finally {
				linked?.cleanup();
			}
		},
	}),

	web_fetch: tool({
		description:
			"Fetch the contents of a URL. By default returns text-only content (strips HTML). Set textOnly=false for raw HTML.",
		inputSchema: z.object({
			url: z.string().describe("The URL to fetch"),
			textOnly: z
				.boolean()
				.optional()
				.describe("Extract text only, stripping HTML (default: true)"),
			offset: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Character offset for chunked reads of fetched content"),
		}),
		execute: async (
			{ url, textOnly = true, offset = 0 },
			{ abortSignal } = {},
		) => {
			console.log(`[web_fetch] Fetching: ${url} (textOnly: ${textOnly})`);
			try {
				const response = await fetchWithLinkedAbort(
					url,
					{
						headers: { "User-Agent": "Mozilla/5.0 (compatible; SepiaBot/1.0)" },
					},
					abortSignal,
					20_000,
					"Web fetch timed out",
				);
				if (!response.ok) {
					return `Error: HTTP ${response.status} ${response.statusText}`;
				}
				let text = await response.text();

				// Strip HTML tags if textOnly mode
				if (textOnly) {
					// Remove script and style blocks first
					text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
					text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
					// Remove HTML tags
					text = text.replace(/<[^>]+>/g, " ");
					// Decode common HTML entities
					text = text
						.replace(/&nbsp;/g, " ")
						.replace(/&amp;/g, "&")
						.replace(/&lt;/g, "<")
						.replace(/&gt;/g, ">")
						.replace(/&quot;/g, '"')
						.replace(/&#39;/g, "'");
					// Collapse whitespace
					text = text.replace(/\s+/g, " ").trim();
				}

				return buildChunkedTextResult(text, await getChunkCharacterBudget(), {
					label: url,
					offset,
				});
			} catch (err) {
				if (abortSignal?.aborted) {
					throw err;
				}
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),

	get_env_vars: tool({
		description:
			"Get all environment variables and whether they are configured",
		inputSchema: z.object({}),
		execute: async () => {
			const summary = await getEnvSummary();
			return summary.map(({ key, configured, isSecret }) => ({
				key,
				configured,
				isSecret,
				value: isSecret ? "***" : (getEnvVar(key) ?? null),
			}));
		},
	}),

	set_env_var: tool({
		description:
			"Set an environment variable. Use uppercase letters and underscores only.",
		inputSchema: z.object({
			key: z.string().describe("Variable name (uppercase, underscores)"),
			value: z.string().describe("Variable value (can be empty)"),
		}),
		execute: async ({ key, value }) => {
			if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
				return `Error: Invalid env var name: ${key}. Use uppercase letters and underscores only.`;
			}
			const result = await setEnvVar(key, value);
			return result.success ? `Set ${key}` : `Error: ${result.error}`;
		},
	}),

	delete_env_var: tool({
		description: "Delete an environment variable from configuration",
		inputSchema: z.object({
			key: z.string().describe("Variable name to delete"),
		}),
		execute: async ({ key }) => {
			const result = await deleteEnvVar(key);
			return result.success ? `Deleted ${key}` : `Error: ${result.error}`;
		},
	}),

	refresh_thread: tool({
		description:
			"Refresh the live conversation thread state so long-running work can see recent user updates without replaying the full chat history.",
		inputSchema: z.object({
			conversationId: z
				.string()
				.optional()
				.describe("Conversation id (default: telegram)"),
			sinceTimestamp: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Only include messages newer than this timestamp"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe("Maximum number of recent messages to include"),
		}),
		execute: async ({ conversationId, sinceTimestamp, limit }) => {
			return buildThreadState(
				conversationId || TELEGRAM_CONVERSATION_ID,
				sinceTimestamp,
				limit,
			);
		},
	}),

	ask_user: tool({
		description:
			"Pause the live run and ask the Telegram admin one clear question when required information is missing.",
		inputSchema: z.object({
			question: z.string().min(1).describe("The question the user must answer"),
		}),
		execute: async ({ question }) => ({
			success: true,
			blocked: true,
			question,
		}),
	}),

	send_message: tool({
		description:
			"Send a message to the Telegram admin during the live run. To show images or files to the user, you MUST use the 'files' parameter - mentioning files in the message text will NOT render them. Images (png, jpg, gif, webp, svg) will be displayed inline, other files get download buttons.",
		inputSchema: z.object({
			message: z.string().describe("The message to send"),
			files: z
				.array(z.string())
				.optional()
				.describe(
					"Array of workspace file paths to attach. IMPORTANT: Must be an array like ['path/to/file.pdf'], not a string.",
				),
		}),
		execute: async ({ message, files }, { abortSignal } = {}) => {
			console.log(
				`[send_message] Telegram: ${(message || "").slice(0, 100)}...${files ? ` (files: ${JSON.stringify(files)})` : ""}`,
			);

			if (!message) {
				return {
					success: false,
					messageDelivered: false,
					error: "message parameter is required",
				};
			}

			try {
				let fileList: string[] = [];
				if (Array.isArray(files)) {
					fileList = files.filter((f): f is string => typeof f === "string");
				} else if (typeof files === "string") {
					try {
						const parsed = JSON.parse(files);
						if (Array.isArray(parsed)) {
							fileList = parsed.filter(
								(f): f is string => typeof f === "string",
							);
						} else if (typeof parsed === "string") {
							fileList = [parsed];
						}
					} catch {
						fileList = [files];
					}
				}

				const attachments = fileList
					.map((filePath) => buildWorkspaceAttachment(filePath))
					.filter((attachment): attachment is NonNullable<typeof attachment> =>
						Boolean(attachment),
					);

				const warnings: string[] = [];
				for (const filePath of fileList) {
					if (!buildWorkspaceAttachment(filePath)) {
						warnings.push(`Access denied or missing file: ${filePath}`);
					}
				}

				const result = await sendTelegramMessageToAdmin(
					message,
					attachments.map((file) => file.path),
					abortSignal,
				);

				if (result.messageDelivered) {
					conversationStore.addMessage(
						"telegram",
						"assistant",
						message,
						"telegram",
						undefined,
						undefined,
						attachments.length > 0 ? attachments : undefined,
					);
				}

				return {
					success: result.ok,
					messageDelivered: result.messageDelivered,
					filesAttached: result.attachments.map((file) => file.filename),
					warnings: [...warnings, ...result.warnings],
					...(result.messageDelivered
						? {}
						: { error: "Failed to send Telegram message" }),
				};
			} catch (err) {
				if (abortSignal?.aborted) {
					throw err;
				}
				return {
					success: false,
					messageDelivered: false,
					error: err instanceof Error ? err.message : "Unknown error",
				};
			}
		},
	}),

	browser: tool({
		description:
			"Control a headless web browser for navigation, clicking, typing, screenshots, and scraping. The browser is BUILT-IN and WORKS IMMEDIATELY - never run any installation, setup, npm, pip, or apt commands. Commands: open <url>, snapshot -i (get clickable elements with @e1 @e2 refs), click @ref, fill @ref 'text', press Enter, screenshot [path], wait <ref|ms>, back, close. ALWAYS use snapshot -i first to get element refs like @e1 @e2 - never guess selectors.",
		inputSchema: z.object({
			command: z.string().describe("Browser command to execute"),
			session: z
				.string()
				.optional()
				.describe("Session name for isolated browser instance"),
			offset: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Character offset for chunked reads of browser output"),
		}),
		execute: async ({ command, session, offset = 0 }) => {
			if (!command) {
				return "Error: command parameter is required. Provide a browser command like 'open https://example.com' or 'snapshot -i'.";
			}
			console.log(`[browser] Running: ${command}`);
			try {
				let fullCommand = "agent-browser";
				if (session) {
					fullCommand += ` --session "${session}"`;
				}
				fullCommand += ` ${command}`;

				const proc = Bun.spawn(["sh", "-c", fullCommand], {
					cwd: WORKSPACE,
					env: process.env,
					stdout: "pipe",
					stderr: "pipe",
				});

				let stdout = await new Response(proc.stdout).text();
				let stderr = await new Response(proc.stderr).text();
				const exitCode = await proc.exited;

				// Strip ANSI color codes for cleaner output
				const ansiPattern = new RegExp(["\\x1b", "\\[[0-9;]*m"].join(""), "g");
				stdout = stdout.replace(ansiPattern, "");
				stderr = stderr.replace(ansiPattern, "");

				const output =
					exitCode !== 0
						? `Browser error: ${stderr || stdout}`
						: stdout || stderr || "OK";

				return buildChunkedTextResult(output, await getChunkCharacterBudget(), {
					label: `browser:${command}`,
					offset,
				});
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),
};
