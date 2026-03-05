// @ts-nocheck - Type inference issues with AI SDK tool() in strict mode
/**
 * AI SDK Tool Definitions
 *
 * Converts our tool implementations to AI SDK format with Zod schemas.
 * Used by the agent for native function calling.
 */

import { tool } from "ai";
import { z } from "zod";
import { getApiKey } from "./api-keys.js";
import { getSourceChannel } from "./context.js";
import { conversationStore } from "./conversation.js";
import { deleteEnvVar, getEnvSummary, getEnvVar, setEnvVar } from "./env.js";
import { getGateway } from "./gateway/manager.js";

const WORKSPACE = "/app/ws";

// Tool definitions using AI SDK's tool() function
export const aiTools = {
	web_search: tool({
		description: "Search the web for information using Tavily API",
		inputSchema: z.object({
			query: z.string().describe("The search query"),
		}),
		execute: async ({ query }) => {
			if (!query) {
				return "Error: query parameter is required. Provide a search term.";
			}
			console.log(`[web_search] Searching for: "${query}"`);
			const apiKey = getApiKey("tavily");
			if (!apiKey) {
				return "Error: TAVILY_API_KEY not configured";
			}

			const response = await fetch("https://api.tavily.com/search", {
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
			});

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
		},
	}),

	read_file: tool({
		description: "Read the contents of a file",
		inputSchema: z.object({
			path: z.string().describe("Absolute path to the file to read"),
		}),
		execute: async ({ path }) => {
			console.log(`[read_file] Reading: ${path}`);
			const MAX_CONTENT = 20000; // characters
			try {
				const file = Bun.file(path);
				const exists = await file.exists();
				if (!exists) {
					return `Error: File not found: ${path}`;
				}
				const text = await file.text();
				if (text.length > MAX_CONTENT) {
					console.log(`[read_file] Truncated ${text.length} to ${MAX_CONTENT}`);
					return (
						text.slice(0, MAX_CONTENT) + "\n\n[File truncated due to size]"
					);
				}
				return text;
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
				await Bun.write(path, content);
				return `Successfully wrote ${content.length} bytes to ${path}`;
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
				const file = Bun.file(path);
				const exists = await file.exists();
				if (!exists) {
					return `Error: File not found: ${path}`;
				}

				const content = await file.text();
				if (!content.includes(old_string)) {
					return `Error: old_string not found in file: ${old_string.slice(0, 100)}...`;
				}

				const newContent = content.replace(old_string, new_string);
				await Bun.write(path, newContent);
				return `Successfully edited ${path}`;
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
		execute: async ({ path = "/app/ws" }) => {
			console.log(`[list_dir] Listing: ${path}`);
			try {
				const result = await Bun.$`ls -F ${path}`;
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
		}),
		execute: async ({ command }) => {
			console.log(`[exec] Running: ${command}`);
			const MAX_OUTPUT = 15000; // characters
			const TIMEOUT_MS = 140 * 1000; // 2 minutes 20 seconds

			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

				const proc = Bun.spawn(["sh", "-c", command], {
					cwd: WORKSPACE,
					env: process.env,
					stdout: "pipe",
					stderr: "pipe",
					signal: controller.signal,
				});

				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const exitCode = await proc.exited;

				clearTimeout(timeoutId);

				let output =
					exitCode !== 0
						? `Error (exit ${exitCode}): ${stderr || stdout}`
						: stdout || stderr || "Command completed successfully";

				if (output.length > MAX_OUTPUT) {
					console.log(`[exec] Truncated ${output.length} to ${MAX_OUTPUT}`);
					output =
						output.slice(0, MAX_OUTPUT) + "\n\n[Output truncated due to size]";
				}
				return output;
			} catch (err) {
				if (
					err instanceof Error &&
					(err.name === "AbortError" || err.message?.includes("abort"))
				) {
					return `Error: Command timed out after 140 seconds. Try breaking this into smaller steps.`;
				}
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
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
		}),
		execute: async ({ url, textOnly = true }) => {
			console.log(`[web_fetch] Fetching: ${url} (textOnly: ${textOnly})`);
			const MAX_CONTENT = 15000; // characters (~4k tokens)
			try {
				const response = await fetch(url, {
					headers: { "User-Agent": "Mozilla/5.0 (compatible; SepiaBot/1.0)" },
				});
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

				if (text.length > MAX_CONTENT) {
					console.log(`[web_fetch] Truncated ${text.length} to ${MAX_CONTENT}`);
					return (
						text.slice(0, MAX_CONTENT) + "\n\n[Content truncated due to size]"
					);
				}
				return text;
			} catch (err) {
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

	send_message: tool({
		description:
			"Send a message to the user via web interface and/or Telegram. To show images or files to the user, you MUST use the 'files' parameter - mentioning files in the message text will NOT render them. Images (png, jpg, gif, webp, svg) will be displayed inline, other files get download buttons.",
		inputSchema: z.object({
			message: z.string().describe("The message to send"),
			channel: z
				.enum(["web", "telegram", "both"])
				.optional()
				.describe("Channel to use (default: web)"),
			files: z
				.array(z.string())
				.optional()
				.describe(
					"Array of workspace file paths to attach. IMPORTANT: Must be an array like ['path/to/file.pdf'], not a string.",
				),
		}),
		execute: async ({ message, channel, files }) => {
			const targetChannel = channel || getSourceChannel();
			console.log(
				`[send_message] Sent to ${targetChannel}: ${(message || "").slice(0, 100)}...${files ? ` (files: ${JSON.stringify(files)})` : ""}`,
			);

			// Validate required message parameter
			if (!message) {
				return "Error: message parameter is required";
			}
			try {
				const gateway = getGateway();
				const results: string[] = [];
				const attachedFiles: Array<{
					filename: string;
					path: string;
					size?: number;
					downloadUrl: string;
				}> = [];
				const warnings: string[] = [];

				// Process file attachments
				// Safety check: ensure files is an array (LLM might pass string or JSON string)
				let fileList: string[] = [];
				if (Array.isArray(files)) {
					fileList = files.filter((f): f is string => typeof f === "string");
				} else if (typeof files === "string") {
					// Try to parse as JSON array first (LLM might pass '["file.txt"]' as string)
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
						// Not valid JSON, treat as single file path
						fileList = [files];
					}
				}

				if (fileList.length > 0) {
					for (const filePath of fileList) {
						try {
							const file = Bun.file(filePath);
							const exists = await file.exists();

							if (!exists) {
								warnings.push(`File not found: ${filePath}`);
								continue;
							}

							// Get relative path for URL (strip /app/ws/ prefix if present)
							const relativePath = filePath
								.replace("/app/ws/", "")
								.replace("/app/ws", "");
							attachedFiles.push({
								filename: filePath.split("/").pop() || filePath,
								path: filePath,
								size: file.size,
								downloadUrl: `/files/${relativePath}`,
							});
						} catch (err) {
							const errorMsg =
								err instanceof Error ? err.message : "Unknown error";
							warnings.push(`Access denied: ${filePath} (${errorMsg})`);
						}
					}
				}

				// Send to web channel
				if (targetChannel === "web" || targetChannel === "both") {
					const webChannel = gateway.getWebChannel();
					if (webChannel) {
						// Send file attachments first if any
						if (attachedFiles.length > 0) {
							console.log(
								`[send_message] Broadcasting ${attachedFiles.length} files to web`,
							);
							webChannel.broadcast("default", {
								type: "file",
								files: attachedFiles,
							});
							// Small delay to ensure file message is processed before content
							await new Promise((resolve) => setTimeout(resolve, 50));
						}
						// Send the message content
						webChannel.broadcast("default", {
							type: "content",
							content: message,
							done: true,
						});
						conversationStore.addMessage(
							"default",
							"assistant",
							message,
							"web",
							undefined,
							undefined,
							attachedFiles.length > 0 ? attachedFiles : undefined,
						);
						results.push("web");
					}
				}

				// Send to telegram channel
				if (targetChannel === "telegram" || targetChannel === "both") {
					const telegramChannel = gateway.getTelegramChannel();
					if (telegramChannel) {
						// Append file markers for Telegram (it handles these internally)
						let telegramMessage = message;
						for (const file of attachedFiles) {
							telegramMessage += `\n[FILE: ${file.path}]`;
						}
						await telegramChannel.broadcast(telegramMessage);
						conversationStore.addMessage(
							"default",
							"assistant",
							message,
							undefined,
							undefined,
							undefined,
							attachedFiles.length > 0 ? attachedFiles : undefined,
						);
						results.push("telegram");
					}
				}

				// Build result message
				if (results.length === 0) {
					let errorMsg = `Error: No channels available for '${channel}'`;
					if (warnings.length > 0) {
						errorMsg += `\nWarnings: ${warnings.join(", ")}`;
					}
					return errorMsg;
				}

				let resultMsg = `Message sent to: ${results.join(", ")}`;
				if (attachedFiles.length > 0) {
					resultMsg += `\nFiles attached: ${attachedFiles.map((f) => f.filename).join(", ")}`;
				}
				if (warnings.length > 0) {
					resultMsg += `\nWarnings: ${warnings.join(", ")}`;
				}
				return resultMsg;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
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
		}),
		execute: async ({ command, session }) => {
			if (!command) {
				return "Error: command parameter is required. Provide a browser command like 'open https://example.com' or 'snapshot -i'.";
			}
			console.log(`[browser] Running: ${command}`);
			const MAX_OUTPUT = 15000;
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
				stdout = stdout.replace(/\x1b\[[0-9;]*m/g, "");
				stderr = stderr.replace(/\x1b\[[0-9;]*m/g, "");

				let output =
					exitCode !== 0
						? `Browser error: ${stderr || stdout}`
						: stdout || stderr || "OK";

				if (output.length > MAX_OUTPUT) {
					console.log(`[browser] Truncated ${output.length} to ${MAX_OUTPUT}`);
					output = output.slice(0, MAX_OUTPUT) + "\n\n[Output truncated]";
				}
				return output;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
			}
		},
	}),
};
