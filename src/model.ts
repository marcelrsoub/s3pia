import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { getApiKey } from "./api-keys.js";

export function createConfiguredLanguageModel(
	modelName = process.env.AI_MODEL || "",
): LanguageModel {
	const apiKey = getApiKey("openrouter");
	if (!apiKey) {
		throw new Error("OpenRouter API key not configured");
	}

	const model = modelName || "anthropic/claude-sonnet-4";
	const openrouter = createOpenRouter({ apiKey });
	return openrouter.chat(model);
}
