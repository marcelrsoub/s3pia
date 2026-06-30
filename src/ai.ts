import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD } from "@earendil-works/pi-ai/oauth";
import {
	type AuthStatus,
	AuthStorage,
	ModelRegistry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { setEnvVar } from "./env.js";
import { workspacePath } from "./workspace.js";

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

const AI_AUTH_PATH = workspacePath(".pi", "agent", "auth.json");
const AI_MODELS_PATH = workspacePath(".pi", "agent", "models.json");
const AI_AGENT_DIR = workspacePath(".pi", "agent");

const authStorage = AuthStorage.create(AI_AUTH_PATH);
const modelRegistry = ModelRegistry.create(authStorage, AI_MODELS_PATH);
const aiSettingsManager = SettingsManager.create(workspacePath(), AI_AGENT_DIR);

export type AiProviderId = "openrouter" | "openai-codex";

export type AiProviderInfo = {
	id: AiProviderId;
	label: string;
	auth: AuthStatus;
	configured: boolean;
};

export type ResolvedAiModelMetadata = {
	provider: string;
	modelId: string;
	name: string;
	baseUrl?: string;
	api?: string;
	contextWindow?: number;
	maxTokens?: number;
};

export type AiModelOption = ResolvedAiModelMetadata & {
	ref: string;
	reasoning: boolean;
	selected: boolean;
};

export type ThinkingLevelOption = {
	value: ThinkingLevel;
	label: string;
	description: string;
};

export type AiPreferences = {
	selectedModelRef?: string;
	effectiveModelRef?: string;
	thinkingLevel: ThinkingLevel;
	providers: Record<AiProviderId, AiProviderInfo>;
	models: AiModelOption[];
	thinkingLevels: ThinkingLevelOption[];
	chatgptLogin: ChatGptLoginState;
	configured: boolean;
};

export const THINKING_LEVEL_OPTIONS: ThinkingLevelOption[] = [
	{
		value: "off",
		label: "Off",
		description: "Minimize reasoning output and keep responses direct.",
	},
	{
		value: "minimal",
		label: "Minimal",
		description: "Use the lightest reasoning mode available.",
	},
	{
		value: "low",
		label: "Low",
		description: "Favor shorter internal reasoning.",
	},
	{
		value: "medium",
		label: "Medium",
		description: "Balanced reasoning depth for most tasks.",
	},
	{
		value: "high",
		label: "High",
		description: "Spend more effort on harder tasks.",
	},
	{
		value: "xhigh",
		label: "Max",
		description: "Use the strongest reasoning level the model supports.",
	},
];

export type ChatGptLoginState =
	| {
			status: "idle";
			startedAt?: number;
			updatedAt?: number;
	  }
	| {
			status: "starting";
			startedAt: number;
			updatedAt: number;
	  }
	| {
			status: "awaiting_verification";
			startedAt: number;
			updatedAt: number;
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| {
			status: "authenticated";
			startedAt: number;
			updatedAt: number;
	  }
	| {
			status: "error";
			startedAt: number;
			updatedAt: number;
			error: string;
	  };

let chatGptLoginState: ChatGptLoginState = { status: "idle" };
let chatGptLoginInitialPromise: Promise<ChatGptLoginState> | null = null;
let chatGptLoginStartResolver: ((state: ChatGptLoginState) => void) | null =
	null;
let chatGptLoginStartRejecter: ((error: Error) => void) | null = null;

function now(): number {
	return Date.now();
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getConfiguredOpenRouterStatus(): AuthStatus {
	const apiKey = process.env.OPENROUTER_API_KEY?.trim();
	if (apiKey) {
		return {
			configured: true,
			source: "environment",
			label: "OPENROUTER_API_KEY",
		};
	}

	return { configured: false };
}

function getConfiguredChatGptStatus(): AuthStatus {
	return authStorage.getAuthStatus("openai-codex");
}

export function getAiAuthStorage(): AuthStorage {
	return authStorage;
}

export function getAiModelRegistry(): ModelRegistry {
	return modelRegistry;
}

export function getAiSettingsManager(): SettingsManager {
	return aiSettingsManager;
}

export function getAvailableAiModels(): AiModelOption[] {
	const selectedRef = getSelectedModelRef();
	return modelRegistry.getAvailable().map((model) => ({
		ref: `${model.provider}/${model.id}`,
		provider: model.provider,
		modelId: model.id,
		name: model.name,
		baseUrl: model.baseUrl,
		api: model.api,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		reasoning: model.reasoning,
		selected: selectedRef === `${model.provider}/${model.id}`,
	}));
}

export function getSelectedModelRef(): string | undefined {
	const explicitModel = process.env.AI_MODEL?.trim();
	if (explicitModel) {
		return explicitModel;
	}

	const defaultProvider = aiSettingsManager.getDefaultProvider()?.trim();
	const defaultModel = aiSettingsManager.getDefaultModel()?.trim();
	if (defaultProvider && defaultModel) {
		return `${defaultProvider}/${defaultModel}`;
	}

	return undefined;
}

export function getEffectiveModelRef(): string | undefined {
	const selectedRef = getSelectedModelRef();
	if (selectedRef) {
		const selectedModel = resolveRequestedModel(selectedRef);
		if (selectedModel) {
			return `${selectedModel.provider}/${selectedModel.id}`;
		}
	}

	const availableModels = modelRegistry.getAvailable();
	return availableModels[0]
		? `${availableModels[0].provider}/${availableModels[0].id}`
		: undefined;
}

export function getSelectedThinkingLevel(): ThinkingLevel {
	const selectedThinkingLevel = aiSettingsManager.getDefaultThinkingLevel();
	if (
		selectedThinkingLevel &&
		THINKING_LEVEL_OPTIONS.some(
			(option) => option.value === selectedThinkingLevel,
		)
	) {
		return selectedThinkingLevel;
	}

	return "medium";
}

export function getAiProviders(): Record<AiProviderId, AiProviderInfo> {
	const openrouter = getConfiguredOpenRouterStatus();
	const openaiCodex = getConfiguredChatGptStatus();

	return {
		openrouter: {
			id: "openrouter",
			label: "OpenRouter",
			auth: openrouter,
			configured: openrouter.configured,
		},
		"openai-codex": {
			id: "openai-codex",
			label: "ChatGPT Plus",
			auth: openaiCodex,
			configured: openaiCodex.configured,
		},
	};
}

export function hasAnyConfiguredAiProvider(): boolean {
	const providers = getAiProviders();
	return (
		providers.openrouter.configured || providers["openai-codex"].configured
	);
}

export function getChatGptLoginState(): ChatGptLoginState {
	return chatGptLoginState;
}

export function getAiPreferences(): AiPreferences {
	return {
		selectedModelRef: getSelectedModelRef(),
		effectiveModelRef: getEffectiveModelRef(),
		thinkingLevel: getSelectedThinkingLevel(),
		providers: getAiProviders(),
		models: getAvailableAiModels(),
		thinkingLevels: THINKING_LEVEL_OPTIONS,
		chatgptLogin: getChatGptLoginState(),
		configured: hasAnyConfiguredAiProvider(),
	};
}

export async function updateAiPreferences(input: {
	modelRef?: string | null;
	thinkingLevel?: ThinkingLevel | null;
}): Promise<AiPreferences> {
	if (input.modelRef !== undefined) {
		const nextModelRef = input.modelRef?.trim();
		if (nextModelRef) {
			await setEnvVar("AI_MODEL", nextModelRef);
			const resolved = resolveRequestedModel(nextModelRef);
			if (resolved) {
				aiSettingsManager.setDefaultModelAndProvider(
					resolved.provider,
					resolved.id,
				);
			}
		} else {
			await setEnvVar("AI_MODEL", "");
			aiSettingsManager.setDefaultModelAndProvider("", "");
		}
	}

	if (input.thinkingLevel !== undefined && input.thinkingLevel !== null) {
		aiSettingsManager.setDefaultThinkingLevel(input.thinkingLevel);
	}

	return getAiPreferences();
}

export async function startChatGptLogin(): Promise<ChatGptLoginState> {
	const current = getConfiguredChatGptStatus();
	if (current.configured) {
		chatGptLoginState = {
			status: "authenticated",
			startedAt: now(),
			updatedAt: now(),
		};
		return chatGptLoginState;
	}

	if (chatGptLoginState.status === "awaiting_verification") {
		return chatGptLoginState;
	}

	if (chatGptLoginInitialPromise) {
		return await chatGptLoginInitialPromise;
	}

	const startedAt = now();
	chatGptLoginState = {
		status: "starting",
		startedAt,
		updatedAt: startedAt,
	};

	const initialStatePromise = new Promise<ChatGptLoginState>(
		(resolve, reject) => {
			chatGptLoginStartResolver = resolve;
			chatGptLoginStartRejecter = reject;
		},
	);
	chatGptLoginInitialPromise = initialStatePromise;

	void authStorage
		.login("openai-codex", {
			onSelect: async () => OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD,
			onDeviceCode: (info) => {
				const nextState: ChatGptLoginState = {
					status: "awaiting_verification",
					startedAt,
					updatedAt: now(),
					userCode: info.userCode,
					verificationUri: info.verificationUri,
					intervalSeconds: info.intervalSeconds,
					expiresInSeconds: info.expiresInSeconds,
				};
				chatGptLoginState = nextState;
				chatGptLoginStartResolver?.(nextState);
				chatGptLoginStartResolver = null;
				chatGptLoginStartRejecter = null;
				chatGptLoginInitialPromise = null;
			},
			onAuth: (info) => {
				const nextState: ChatGptLoginState = {
					status: "awaiting_verification",
					startedAt,
					updatedAt: now(),
					userCode: info.instructions || "Open the provided link to continue",
					verificationUri: info.url,
				};
				chatGptLoginState = nextState;
				chatGptLoginStartResolver?.(nextState);
				chatGptLoginStartResolver = null;
				chatGptLoginStartRejecter = null;
				chatGptLoginInitialPromise = null;
			},
			onPrompt: async () => {
				throw new Error(
					"Manual prompts are not supported in the web UI login flow",
				);
			},
		})
		.then(() => {
			chatGptLoginState = {
				status: "authenticated",
				startedAt,
				updatedAt: now(),
			};
			chatGptLoginInitialPromise = null;
		})
		.catch((error) => {
			const message = toErrorMessage(error);
			chatGptLoginState = {
				status: "error",
				startedAt,
				updatedAt: now(),
				error: message,
			};
			chatGptLoginStartRejecter?.(new Error(message));
			chatGptLoginStartResolver = null;
			chatGptLoginStartRejecter = null;
			chatGptLoginInitialPromise = null;
		});

	return await initialStatePromise;
}

export function resolveRequestedModel(
	modelReference: string | undefined,
): Model<Api> | undefined {
	const raw = modelReference?.trim();
	if (!raw) {
		return undefined;
	}

	const allModels = modelRegistry.getAll();
	const normalizedReference = raw.toLowerCase();
	const canonicalMatches = allModels.filter(
		(model) =>
			`${model.provider}/${model.id}`.toLowerCase() === normalizedReference,
	);
	if (canonicalMatches.length === 1) {
		const canonicalMatch = canonicalMatches.at(0);
		if (!canonicalMatch) {
			return undefined;
		}
		return modelRegistry.hasConfiguredAuth(canonicalMatch)
			? canonicalMatch
			: undefined;
	}

	if (canonicalMatches.length > 1) {
		const configuredCanonicalMatches = canonicalMatches.filter((model) =>
			modelRegistry.hasConfiguredAuth(model),
		);
		if (configuredCanonicalMatches.length === 1) {
			return configuredCanonicalMatches.at(0);
		}
	}

	if (raw.includes("/")) {
		const [provider, ...rest] = raw.split("/");
		const modelId = rest.join("/").trim();
		if (provider && modelId) {
			const match = modelRegistry.find(provider.trim(), modelId);
			if (match && modelRegistry.hasConfiguredAuth(match)) {
				return match;
			}
		}
	}

	const idMatches = allModels.filter(
		(model) => model.id.toLowerCase() === normalizedReference,
	);
	const configuredMatches = idMatches.filter((model) =>
		modelRegistry.hasConfiguredAuth(model),
	);
	if (configuredMatches.length === 1) {
		return configuredMatches.at(0);
	}

	if (configuredMatches.length > 1) {
		return configuredMatches.at(0);
	}

	return undefined;
}

export function getResolvedAiModelMetadata(
	modelReference: string | undefined,
): ResolvedAiModelMetadata | null {
	const model = resolveRequestedModel(modelReference);
	if (!model) {
		return null;
	}

	return {
		provider: model.provider,
		modelId: model.id,
		name: model.name,
		baseUrl: model.baseUrl,
		api: model.api,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}
