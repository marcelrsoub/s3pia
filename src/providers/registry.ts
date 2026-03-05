/**
 * Provider Registry
 *
 * Central registry for all LLM providers.
 * Adding a new provider takes just 2 steps:
 * 1. Add ProviderSpec to PROVIDERS constant
 * 2. Add field to config schema
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

/**
 * Provider specification - single source of truth for each provider
 */
export interface ProviderSpec {
	/** Unique identifier (used in config) */
	name: string;
	/** Display name for UI/logs */
	displayName: string;
	/** Model name keywords for auto-detection */
	keywords: string[];
	/** Environment variable name for API key */
	envKey: string;
	/** API base URL */
	baseURL: string;
	/** Default model identifier */
	defaultModel: string;
	/** Can route any model (like OpenRouter) */
	isGateway?: boolean;
	/** Detect gateway by API key prefix */
	detectByKeyPrefix?: string;
	/** Skip prefixing if model already starts with these */
	skipPrefixes?: string[];
	/** Extra environment variables to set */
	envExtras?: Array<[string, string]>;
}

/**
 * All supported providers
 * Add new providers here - no other code changes needed!
 *
 * Provider packages used:
 * - zai: zhipu-ai-provider (community)
 * - openrouter: @openrouter/ai-sdk-provider (community)
 * - anthropic: @ai-sdk/anthropic (official)
 * - openai: @ai-sdk/openai (official)
 * - deepseek: @ai-sdk/deepseek (official)
 * - groq: @ai-sdk/groq (official)
 * - gemini: @ai-sdk/google (official)
 */
export const PROVIDERS: Record<string, ProviderSpec> = {
	// Z.AI (Zhipu GLM models)
	zai: {
		name: "zai",
		displayName: "Z.AI",
		keywords: ["zai", "glm", "chatglm"],
		envKey: "ZAI_API_KEY",
		baseURL: "https://api.z.ai/api/coding/paas/v4",
		defaultModel: "glm-4-plus",
	},

	// OpenRouter (gateway to 100+ models)
	openrouter: {
		name: "openrouter",
		displayName: "OpenRouter",
		keywords: ["openrouter", "anthropic", "claude", "openai", "gpt"],
		envKey: "OPENROUTER_API_KEY",
		baseURL: "https://openrouter.ai/api/v1",
		defaultModel: "anthropic/claude-sonnet-4",
		isGateway: true,
		detectByKeyPrefix: "sk-or-",
		skipPrefixes: ["openrouter/", "anthropic/", "openai/"],
	},

	// Anthropic (Claude direct)
	anthropic: {
		name: "anthropic",
		displayName: "Anthropic",
		keywords: ["anthropic", "claude"],
		envKey: "ANTHROPIC_API_KEY",
		baseURL: "https://api.anthropic.com/v1",
		defaultModel: "claude-sonnet-4-20250514",
		skipPrefixes: ["anthropic/"],
	},

	// OpenAI (GPT direct)
	openai: {
		name: "openai",
		displayName: "OpenAI",
		keywords: ["openai", "gpt", "o1"],
		envKey: "OPENAI_API_KEY",
		baseURL: "https://api.openai.com/v1",
		defaultModel: "gpt-4.1",
		skipPrefixes: ["openai/"],
	},

	// DeepSeek
	deepseek: {
		name: "deepseek",
		displayName: "DeepSeek",
		keywords: ["deepseek"],
		envKey: "DEEPSEEK_API_KEY",
		baseURL: "https://api.deepseek.com/v1",
		defaultModel: "deepseek-chat",
	},

	// Groq (fast inference)
	groq: {
		name: "groq",
		displayName: "Groq",
		keywords: ["groq", "llama"],
		envKey: "GROQ_API_KEY",
		baseURL: "https://api.groq.com/openai/v1",
		defaultModel: "llama-3.3-70b-versatile",
	},

	// Google Gemini
	gemini: {
		name: "gemini",
		displayName: "Google Gemini",
		keywords: ["gemini", "google"],
		envKey: "GEMINI_API_KEY",
		baseURL: "https://generativelanguage.googleapis.com/v1beta",
		defaultModel: "gemini-2.0-flash",
	},
};

/**
 * Get provider spec by name
 */
export function getProviderByName(name: string): ProviderSpec | undefined {
	return PROVIDERS[name];
}

/**
 * Detect provider from API key prefix
 */
export function detectProviderFromKey(
	apiKey: string,
): ProviderSpec | undefined {
	for (const provider of Object.values(PROVIDERS)) {
		if (
			provider.detectByKeyPrefix &&
			apiKey.startsWith(provider.detectByKeyPrefix)
		) {
			return provider;
		}
	}
	return undefined;
}

/**
 * Detect provider from model name
 */
export function detectProviderFromModel(
	model: string,
): ProviderSpec | undefined {
	// Check for gateway first (OpenRouter can route any model)
	const openrouter = PROVIDERS.openrouter;
	if (openrouter?.isGateway) {
		// Check if model has openrouter prefix or no prefix
		if (model.startsWith("openrouter/") || !model.includes("/")) {
			return openrouter;
		}
	}

	// Check skip prefixes
	for (const provider of Object.values(PROVIDERS)) {
		if (provider.skipPrefixes) {
			for (const prefix of provider.skipPrefixes) {
				if (model.startsWith(prefix)) {
					return provider;
				}
			}
		}
	}

	// Check keywords
	const modelLower = model.toLowerCase();
	for (const provider of Object.values(PROVIDERS)) {
		for (const keyword of provider.keywords) {
			if (modelLower.includes(keyword)) {
				return provider;
			}
		}
	}

	// Default to first provider
	return Object.values(PROVIDERS)[0];
}

/**
 * Get all provider names
 */
export function getAllProviderNames(): string[] {
	return Object.keys(PROVIDERS);
}

/**
 * Get all gateway providers (can route any model)
 */
export function getGatewayProviders(): ProviderSpec[] {
	return Object.values(PROVIDERS).filter((p) => p.isGateway);
}
