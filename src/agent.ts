/**
 * Autonomous Agent using AI SDK's maxSteps pattern
 *
 * The agent uses AI SDK's built-in tool chaining with maxSteps,
 * which automatically handles tool call/result loops.
 */

import {
	APICallError,
	generateText,
	type LanguageModel,
	RetryError,
	stepCountIs,
} from "ai";
import { aiTools } from "./ai-tools.js";
import type { Message } from "./conversation.js";
import { getEnvSummary } from "./env.js";
import type { Action, ExecutionResult } from "./memory.js";
import { getMemory } from "./memory.js";
import { createConfiguredLanguageModel } from "./model.js";
import { estimateTokens, getActiveModelBudget } from "./openrouter.js";
import { loadWorkspaceContext } from "./prompts.js";
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

interface PromptMessage {
	role: "user" | "assistant";
	content: string;
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

export function buildTaskSnapshot(messages: Message[]): string | null {
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
	): Promise<ExecutionResult> {
		const startTime = Date.now();

		console.log(`[Agent] Starting task: "${task.slice(0, 100)}..."`);

		const systemPrompt = await this.buildSystemPrompt();

		const budget = await getActiveModelBudget();
		const messages = this.buildPromptMessages(
			task,
			conversationHistory || [],
			budget,
		);

		const abortController = new AbortController();
		const timeoutId = setTimeout(
			() => abortController.abort(),
			this.config.maxTime,
		);

		try {
			const result = await generateText({
				model: this.getModel(),
				system: systemPrompt,
				messages,
				tools: aiTools,
				toolChoice: "auto",
				stopWhen: stepCountIs(this.config.maxSteps),
				maxRetries: 2,
				abortSignal: abortController.signal,
			});
			clearTimeout(timeoutId);

			const actions: Action[] = [];
			let usedSendMessage = false;
			let blockedQuestion: string | undefined;

			if (result.steps) {
				for (const step of result.steps) {
					if (step.toolCalls) {
						for (const tc of step.toolCalls) {
							if (tc.toolName === "send_message") {
								usedSendMessage = true;
							}
							if (
								tc.toolName === "ask_user" &&
								typeof tc.input === "object" &&
								tc.input !== null &&
								"question" in tc.input &&
								typeof tc.input.question === "string"
							) {
								blockedQuestion = tc.input.question;
							}

							actions.push({
								type: "tool",
								tool: tc.toolName,
								params:
									typeof tc.input === "object" && tc.input !== null
										? (tc.input as Record<string, unknown>)
										: {},
							});

							const toolResult = step.toolResults?.find(
								(tr) => tr.toolCallId === tc.toolCallId,
							);
							const action = actions.at(-1);
							if (toolResult && action) {
								action.result = toolResult.output;
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
				blocked: Boolean(blockedQuestion),
				question: blockedQuestion,
			};

			await this.memory.saveExecution(finalResult);
			return finalResult;
		} catch (err) {
			clearTimeout(timeoutId);
			console.error("[Agent] generateText error:", err);

			if (
				err instanceof Error &&
				(err.name === "AbortError" || err.message.includes("aborted"))
			) {
				const timeoutResult: ExecutionResult = {
					task,
					result: `Error: task exceeded the ${this.config.maxTime / 1000}s time limit`,
					actions: [],
					iterations: 0,
					duration: Date.now() - startTime,
					incomplete: true,
					usedSendMessage: false,
					error: {
						type: "api_error",
						message: "Task timed out",
						provider: "openrouter",
					},
				};

				await this.memory.saveExecution(timeoutResult);
				return timeoutResult;
			}

			const providerName = "openrouter";
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
2. Use send_message only for the final completed response
3. If required information is missing, call ask_user with one clear question and stop
4. Work silently during execution - don't send progress updates or acknowledgments
5. **ALWAYS provide a summary of what you did and the result after completing the task**
6. To show images or files, use the 'files' parameter in send_message
7. If information is unclear but nonessential, make a reasonable assumption and explain it
8. Use skills in /app/ws/skills/ when appropriate - read them with read_file
9. If the user specifies which tool(s) to use, respect that restriction strictly - do not switch to other tools
10. For long outputs, work in phases: outline, notes, draft sections, assemble, verify, deliver
11. Prefer writing large intermediate outputs to workspace files and resume from those files instead of keeping everything in one prompt
12. If tool output is chunked, request the most relevant next chunk instead of assuming the missing content is irrelevant
13. Before sending a progress update or final response on a long task, call refresh_thread and re-read the live conversation for any new user updates

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

	private getModel(): LanguageModel {
		return createConfiguredLanguageModel();
	}

	private buildPromptMessages(
		task: string,
		conversationHistory: Message[],
		budget: Awaited<ReturnType<typeof getActiveModelBudget>>,
	): PromptMessage[] {
		const prioritized: PromptMessage[] = [];
		const snapshot = buildTaskSnapshot(conversationHistory);
		const recentMessages = conversationHistory.filter(
			(m) => m.role !== "system",
		);

		prioritized.push({
			role: "user",
			content: `Current task:\n${task}`,
		});

		if (snapshot) {
			prioritized.push({
				role: "assistant",
				content: `Active task snapshot:\n${snapshot}`,
			});
		}

		for (const msg of recentMessages.slice(-10).reverse()) {
			const role = msg.role === "assistant" ? "assistant" : "user";
			prioritized.push({
				role,
				content: compactText(msg.content, role === "assistant" ? 500 : 700),
			});
		}

		const { messages, droppedCount } = takeMessagesWithinBudget(
			prioritized,
			Math.max(2_048, budget.usableInputTokens),
		);

		if (droppedCount > 0) {
			console.warn(
				`[Agent] Dropped ${droppedCount} low-priority context message(s) to fit prompt budget`,
			);
		}

		return messages.reverse();
	}
}

export { Agent };
