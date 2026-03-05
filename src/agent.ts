/**
 * Autonomous Agent using AI SDK's maxSteps pattern
 *
 * The agent uses AI SDK's built-in tool chaining with maxSteps,
 * which automatically handles tool call/result loops.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, RetryError, stepCountIs } from "ai";
import { createZhipu } from "zhipu-ai-provider";
import { aiTools } from "./ai-tools.js";
import { getApiKey } from "./api-keys.js";
import { setSourceChannel } from "./context.js";
import type { Message } from "./conversation.js";
import { getEnvSummary } from "./env.js";
import type { Action, ExecutionResult } from "./memory.js";
import { getMemory } from "./memory.js";
import { loadWorkspaceContext } from "./prompts.js";
import { getProviderByName } from "./providers/registry.js";
import { getSkills } from "./skills.js";

function summarizeActions(actions: Action[]): string | null {
	if (actions.length === 0) return null;
	const toolList = actions
		.map((a) => {
			const preview = String(a.result || "")
				.slice(0, 50)
				.replace(/\n/g, " ");
			return `- **${a.tool}**: ${preview}...`;
		})
		.join("\n");
	return `> ⚙️ **Auto-generated summary** (model produced no output)\n>\n> Ran ${actions.length} tool(s):\n>\n${toolList
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n")}`;
}

function classifyApiError(
	err: unknown,
	providerName: string,
): {
	type: "api_quota" | "api_auth" | "api_error";
	message: string;
	statusCode?: number;
} | null {
	let apiError = err;
	if (RetryError.isInstance(err)) {
		apiError = err.lastError;
	}

	if (!APICallError.isInstance(apiError)) {
		return null;
	}

	const statusCode = apiError.statusCode;
	const responseBody = apiError.responseBody as string;

	if (statusCode === 429) {
		const quotaIndicators = [
			"余额不足",
			"insufficient",
			"quota",
			"billing",
			"credits",
			"resource pack",
		];

		const isQuotaError = quotaIndicators.some((indicator) =>
			responseBody?.toLowerCase().includes(indicator.toLowerCase()),
		);

		if (isQuotaError) {
			return {
				type: "api_quota",
				message: `API quota exceeded for ${providerName}. Please add credits.`,
				statusCode,
			};
		}

		return {
			type: "api_quota",
			message: `Rate limited by ${providerName}. Please wait or upgrade.`,
			statusCode,
		};
	}

	if (statusCode === 401 || statusCode === 403) {
		return {
			type: "api_auth",
			message: `Authentication failed for ${providerName}. Check your API key.`,
			statusCode,
		};
	}

	if (statusCode && statusCode >= 400 && statusCode < 500) {
		return {
			type: "api_error",
			message: `API error from ${providerName}: ${apiError.message}`,
			statusCode,
		};
	}

	return null;
}

export interface AgentConfig {
	maxSteps?: number;
	maxTime?: number;
	conversationHistory?: Message[];
}

class Agent {
	private config: Required<AgentConfig>;
	private memory = getMemory();
	private skills = getSkills();

	constructor(config: AgentConfig = {}) {
		this.config = {
			maxSteps: config.maxSteps ?? 50,
			maxTime: config.maxTime ?? 10 * 60 * 1000,
			conversationHistory: config.conversationHistory ?? [],
		};
	}

	async execute(
		task: string,
		conversationHistory?: Message[],
		sourceChannel?: string,
	): Promise<ExecutionResult> {
		const startTime = Date.now();

		console.log(`[Agent] Starting task: "${task.slice(0, 100)}..."`);

		setSourceChannel((sourceChannel as "web" | "telegram") || "web");

		const systemPrompt = await this.buildSystemPrompt();

		const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

		if (conversationHistory && conversationHistory.length > 0) {
			const recentMessages = conversationHistory
				.filter((m) => m.role !== "system")
				.slice(-6);
			for (const msg of recentMessages) {
				messages.push({
					role: msg.role === "assistant" ? "assistant" : "user",
					content: msg.content.slice(0, 500),
				});
			}
		}

		const lastMsg = messages[messages.length - 1];
		if (lastMsg && lastMsg.role === "user") {
			messages[messages.length - 1] = { role: "user", content: task };
		} else {
			messages.push({ role: "user", content: task });
		}

		try {
			const result = await generateText({
				model: this.getModel() as any,
				system: systemPrompt,
				messages,
				tools: aiTools,
				toolChoice: "auto",
				stopWhen: stepCountIs(this.config.maxSteps),
				maxRetries: 2,
			});

			const actions: Action[] = [];
			let usedSendMessage = false;

			if (result.steps) {
				for (const step of result.steps) {
					if (step.toolCalls) {
						for (const tc of step.toolCalls) {
							if (tc.toolName === "send_message") {
								usedSendMessage = true;
							}

							actions.push({
								type: "tool",
								tool: tc.toolName,
								params: (tc as any).args as Record<string, unknown>,
							});

							const toolResult = step.toolResults?.find(
								(tr: any) => tr.toolCallId === tc.toolCallId,
							);
							if (toolResult && actions.length > 0) {
								actions[actions.length - 1]!.result = (
									toolResult as any
								).result;
							}
						}
					}
				}
			}

			console.log(`[Agent] Completed in ${result.steps?.length || 0} steps`);

			for (const action of actions) {
				console.log(
					`[Agent] Tool: ${action.tool} -> ${String(action.result ?? "").slice(0, 100)}...`,
				);
			}

			const finalResult: ExecutionResult = {
				task,
				result: result.text || summarizeActions(actions) || "Task completed",
				actions,
				iterations: result.steps?.length || 1,
				duration: Date.now() - startTime,
				usedSendMessage,
			};

			await this.memory.saveExecution(finalResult);
			return finalResult;
		} catch (err) {
			console.error("[Agent] generateText error:", err);

			const providerName = process.env.AI_PROVIDER || "zai";
			const apiError = classifyApiError(err, providerName);

			if (apiError) {
				const errorResult: ExecutionResult = {
					task,
					result: apiError.message,
					actions: [],
					iterations: 0,
					duration: Date.now() - startTime,
					incomplete: true,
					usedSendMessage: false,
					error: {
						...apiError,
						provider: providerName,
					},
				};

				await this.memory.saveExecution(errorResult);
				return errorResult;
			}

			const errorResult: ExecutionResult = {
				task,
				result: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
				actions: [],
				iterations: 0,
				duration: Date.now() - startTime,
				incomplete: true,
				usedSendMessage: false,
				error: {
					type: "api_error",
					message: err instanceof Error ? err.message : "Unknown error",
					provider: providerName,
				},
			};

			return errorResult;
		}
	}

	private async buildSystemPrompt(): Promise<string> {
		const workspaceContext = await loadWorkspaceContext();
		const skillsSummary = await this.skills.getSkillsSummary();
		const history = await this.memory.getHistory(5);

		let context = `You are an autonomous agent that works on tasks quietly and efficiently.

RULES:
1. Complete the task fully using available tools before responding
2. Only use send_message when the task is complete or you need user input
3. Work silently during execution - don't send progress updates or acknowledgments
4. **ALWAYS provide a summary of what you did and the result after completing the task**
5. To show images or files, use the 'files' parameter in send_message
6. If information is unclear, make a reasonable assumption and explain it
7. Use skills in /app/ws/skills/ when appropriate - read them with read_file
8. If the user specifies which tool(s) to use, respect that restriction strictly - do not switch to other tools

---

${workspaceContext}

---`;

		const envSummary = await getEnvSummary();
		if (envSummary.length > 0) {
			context += `

## ENVIRONMENT VARIABLES
${envSummary
	.map(
		({ key, configured }) =>
			`${key} → ${configured ? "configured" : "not configured"}`,
	)
	.join("\n")}`;
		}

		if (skillsSummary && skillsSummary !== "No skills available.") {
			context += `

Available skills in /app/ws/skills/:
${skillsSummary}

IMPORTANT: When reading a skill, use the filename.md (not the display name in parentheses) with the read_file tool. For example: read_file with path "/app/ws/skills/filename.md"

To create a new skill, read the template first: read_file with path "/app/ws/skills/_template.md"

SCHEDULING: You can schedule tasks to run automatically. Read the scheduling skill for details: read_file with path "/app/ws/skills/scheduling.md"`;
		}

		if (history.length > 0) {
			context += `

Recent similar tasks:
${history.map((h) => `- ${h.task.slice(0, 80)}... -> ${h.result?.slice(0, 80)}...`).join("\n")}`;
		}

		return context;
	}

	private getModel() {
		const providerName = process.env.AI_PROVIDER || "zai";
		const provider = getProviderByName(providerName);

		if (!provider) {
			throw new Error(`Unknown provider: ${providerName}`);
		}

		const model = process.env.AI_MODEL || provider.defaultModel;
		const apiKey = getApiKey(providerName);

		if (!apiKey) {
			throw new Error(`API key not configured for provider: ${providerName}`);
		}

		switch (providerName) {
			case "zai": {
				const zhipu = createZhipu({
					apiKey,
					baseURL: "https://api.z.ai/api/coding/paas/v4",
				});
				return zhipu(model);
			}
			case "openrouter": {
				const openrouter = createOpenRouter({ apiKey });
				return openrouter.chat(model);
			}
			case "anthropic": {
				const anthropic = createAnthropic({ apiKey });
				return anthropic(model);
			}
			case "openai": {
				const openai = createOpenAI({ apiKey });
				return openai.chat(model);
			}
			case "deepseek": {
				const deepseek = createDeepSeek({ apiKey });
				return deepseek(model);
			}
			case "groq": {
				const groq = createGroq({ apiKey });
				return groq(model);
			}
			case "gemini": {
				const google = createGoogleGenerativeAI({ apiKey });
				return google(model);
			}
			default:
				throw new Error(`Unsupported provider: ${providerName}`);
		}
	}
}

export { Agent };
