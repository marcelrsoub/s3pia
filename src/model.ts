import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { createZhipu } from "zhipu-ai-provider";
import { getApiKey } from "./api-keys.js";
import { getProviderByName } from "./providers/registry.js";

export function createConfiguredLanguageModel(
	providerName = process.env.AI_PROVIDER || "zai",
	modelName = process.env.AI_MODEL || "",
): LanguageModel {
	const provider = getProviderByName(providerName);

	if (!provider) {
		throw new Error(`Unknown provider: ${providerName}`);
	}

	const apiKey = getApiKey(providerName);
	if (!apiKey) {
		throw new Error(`API key not configured for provider: ${providerName}`);
	}

	const model = modelName || provider.defaultModel;

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
