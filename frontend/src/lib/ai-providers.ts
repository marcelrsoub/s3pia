import type { AIProvider } from "@/hooks/useConfig";

export type { AIProvider };

export interface AIProviderConfig {
	id: AIProvider;
	name: string;
}

export const AI_PROVIDERS: Record<AIProvider, AIProviderConfig> = {
	zai: { id: "zai", name: "Z.AI" },
	openrouter: { id: "openrouter", name: "OpenRouter" },
	anthropic: { id: "anthropic", name: "Anthropic" },
	openai: { id: "openai", name: "OpenAI" },
	deepseek: { id: "deepseek", name: "DeepSeek" },
	groq: { id: "groq", name: "Groq" },
	gemini: { id: "gemini", name: "Google Gemini" },
};
