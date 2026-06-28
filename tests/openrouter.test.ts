import { expect, test } from "bun:test";
import {
	estimateTokens,
	getCachedActiveModelBudget,
	getFallbackModelMetadata,
	getOpenRouterModelRegistry,
} from "../src/openrouter";
import { buildThreadSnapshot, takeMessagesWithinBudget } from "../src/ai-tools";
import type { Message } from "../src/conversation";

test("estimateTokens uses a conservative character heuristic", () => {
	expect(estimateTokens("")).toBe(0);
	expect(estimateTokens("abcd")).toBe(1);
	expect(estimateTokens("a".repeat(17))).toBe(5);
});

test("fallback metadata exposes conservative defaults", () => {
	const metadata = getFallbackModelMetadata("openai/gpt-4.1");
	expect(metadata.id).toBe("openai/gpt-4.1");
	expect(metadata.contextLength).toBeGreaterThan(8000);
	expect(metadata.maxCompletionTokens).toBeGreaterThan(1000);
});

test("model registry refresh normalizes OpenRouter model metadata", async () => {
	const registry = getOpenRouterModelRegistry();
	process.env.OPENROUTER_API_KEY = "test-key";
	const fetcher = (async () =>
		new Response(
			JSON.stringify({
				data: [
					{
						id: "anthropic/claude-sonnet-4",
						canonical_slug: "anthropic/claude-sonnet-4-20250514",
						name: "Claude Sonnet 4",
						context_length: 200000,
						architecture: { tokenizer: "Claude" },
						top_provider: {
							context_length: 128000,
							max_completion_tokens: 8192,
						},
						supported_parameters: ["tools", "max_tokens"],
					},
				],
			}),
			{ status: 200 },
		)) as unknown as typeof fetch;
	await registry.refresh(fetcher);

	const model = await registry.getModel("anthropic/claude-sonnet-4");
	expect(model?.providerContextLength).toBe(128000);
	expect(model?.maxCompletionTokens).toBe(8192);
	expect(model?.supportedParameters).toContain("tools");
});

test("cached active model budget uses cached metadata without network", async () => {
	process.env.AI_MODEL = "anthropic/claude-sonnet-4";
	const budget = getCachedActiveModelBudget();
	expect(budget.model?.id).toBe("anthropic/claude-sonnet-4");
	expect(budget.toolReserveTokens).toBeGreaterThan(2000);
});

test("takeMessagesWithinBudget preserves earlier high-priority items", () => {
	const result = takeMessagesWithinBudget(
		[
			{ role: "user", content: "Current run" },
			{ role: "assistant", content: "Snapshot" },
			{ role: "user", content: "x".repeat(8000) },
		],
		128,
	);

	expect(result.messages[0]?.content).toBe("Current run");
	expect(result.messages[1]?.content).toBe("Snapshot");
	expect(result.droppedCount).toBeGreaterThan(0);
});

test("buildThreadSnapshot captures recent user context and files", () => {
	const history: Message[] = [
		{
			role: "user",
			content: "Please draft a long ebook about climbing.",
			timestamp: Date.now(),
		},
		{
			role: "assistant",
			content: "I will outline it first.",
			timestamp: Date.now(),
			files: [
				{
					filename: "outline.md",
					path: "/app/ws/outline.md",
					downloadUrl: "/files/outline.md",
				},
			],
		},
	];

	const snapshot = buildThreadSnapshot(history);
	expect(snapshot).toContain("Please draft a long ebook");
	expect(snapshot).toContain("/app/ws/outline.md");
});
