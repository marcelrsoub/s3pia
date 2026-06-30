/**
 * HTTP Route Handlers
 *
 * Configuration, status, and Telegram management only.
 */

import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
	type AiModelOption,
	type AiProviderId,
	type AiProviderModelsResponse,
	getAiPreferences,
	getAiProviders,
	getChatGptLoginState,
	getResolvedAiModelMetadata,
	startChatGptLogin,
	type ThinkingLevel,
	updateAiPreferences,
} from "./ai.js";
import { TELEGRAM_CONVERSATION_ID } from "./conversation.js";
import {
	getAllEnvVarsWithMetadata,
	getEnvFileContent,
	getEnvSchema,
	getEnvStatus,
	isEnvConfigured,
	loadEnvFile,
	updateManyEnvVars,
	validateEnv,
} from "./env.js";
import { getGateway } from "./gateway/manager.js";
import { getLiveRunCoordinator } from "./live-run.js";
import { reinitializeAdminUser } from "./telegram-auth.js";
import { workspacePath } from "./workspace.js";

function createErrorResponse(message: string, status = 500): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function createSuccessResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function handleGetEnv(): Promise<Response> {
	try {
		const content = await getEnvFileContent();
		return new Response(content, {
			status: 200,
			headers: { "Content-Type": "text/plain" },
		});
	} catch (err) {
		console.error("[GetEnv] Error:", err);
		return createErrorResponse("Failed to load .env file");
	}
}

export async function handleUpdateEnv(request: Request): Promise<Response> {
	try {
		const content = await request.text();
		if (!content) {
			return createErrorResponse("Content is required");
		}

		const envFile = workspacePath("config", ".env");
		await Bun.$`mkdir -p ${workspacePath("config")}`;
		await Bun.write(envFile, content);
		await loadEnvFile();

		reinitializeAdminUser();
		await getGateway().reinitializeTelegramChannel();

		return createSuccessResponse({
			updated: true,
			message: "Environment variables saved successfully",
		});
	} catch (err) {
		console.error("[UpdateEnv] Error:", err);
		return createErrorResponse("Failed to update .env file");
	}
}

export async function handleConfigStatus(): Promise<Response> {
	return createSuccessResponse(getEnvStatus());
}

export async function handleConfigSchema(): Promise<Response> {
	return createSuccessResponse(getEnvSchema());
}

export async function handleGetConfig(): Promise<Response> {
	return createSuccessResponse({ settings: await getAllEnvVarsWithMetadata() });
}

export async function handleUpdateConfig(request: Request): Promise<Response> {
	try {
		const updates = (await request.json()) as Record<string, string>;
		await updateManyEnvVars(updates);

		const telegramKeys = [
			"TELEGRAM_BOT_TOKEN",
			"ADMIN_TELEGRAM_ID",
			"TELEGRAM_ENABLED",
		];
		if (telegramKeys.some((key) => key in updates)) {
			reinitializeAdminUser();
			await getGateway().reinitializeTelegramChannel();
		}

		return createSuccessResponse({ updated: true });
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to update config",
		);
	}
}

export async function handleValidateConfig(): Promise<Response> {
	return createSuccessResponse(validateEnv());
}

export async function handleTestOpenRouterKey(
	request: Request,
): Promise<Response> {
	try {
		const { apiKey } = (await request.json()) as { apiKey?: string };
		if (!apiKey || typeof apiKey !== "string") {
			return createSuccessResponse({
				valid: false,
				error: "Invalid API key format",
			});
		}

		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});

		return createSuccessResponse({
			valid: response.ok,
			error: response.ok
				? undefined
				: ((await response.json()) as { error?: { message?: string } })?.error
						?.message || "OpenRouter API call failed",
		});
	} catch {
		return createSuccessResponse({ valid: false, error: "Connection failed" });
	}
}

export async function handleTestConfig(request: Request): Promise<Response> {
	try {
		const { apiKey } = (await request.json()) as {
			apiKey?: string;
		};

		if (!apiKey || typeof apiKey !== "string") {
			return createSuccessResponse({
				valid: false,
				error: "Invalid API key format",
			});
		}

		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});

		return createSuccessResponse({
			valid: response.ok,
			error: response.ok
				? undefined
				: ((await response.json()) as { error?: { message?: string } })?.error
						?.message || "API call failed",
		});
	} catch {
		return createSuccessResponse({ valid: false, error: "Connection failed" });
	}
}

export async function handleTelegramBotStatus(): Promise<Response> {
	const gateway = getGateway();
	const telegramChannel = gateway.getTelegramChannel();
	const snapshot = getLiveRunCoordinator().getStatusSnapshot(
		TELEGRAM_CONVERSATION_ID,
	);

	if (!telegramChannel) {
		return createSuccessResponse({
			name: "telegram",
			enabled: false,
			running: false,
			configured: false,
			error: "Telegram channel not configured",
			status: snapshot.status,
			currentRun: snapshot.currentRun,
			canCancel: snapshot.canCancel,
			rerunRequested: snapshot.rerunRequested,
		});
	}

	return createSuccessResponse({
		...telegramChannel.getStatus(),
		configured: true,
		status: snapshot.status,
		currentRun: snapshot.currentRun,
		canCancel: snapshot.canCancel,
		rerunRequested: snapshot.rerunRequested,
	});
}

export async function handleTelegramLiveRunCancel(): Promise<Response> {
	const cancelledRun = getLiveRunCoordinator().cancelActiveRun(
		TELEGRAM_CONVERSATION_ID,
	);
	if (!cancelledRun) {
		return createSuccessResponse({
			cancelled: false,
			message: "No live run to cancel",
		});
	}

	return createSuccessResponse({
		cancelled: true,
		currentRun: cancelledRun,
		message: "Cancel request sent",
	});
}

export async function handleTelegramBotRestart(): Promise<Response> {
	try {
		const telegramChannel = getGateway().getTelegramChannel();
		if (!telegramChannel) {
			return createErrorResponse("Telegram channel not configured", 404);
		}

		await telegramChannel.restart();
		return createSuccessResponse({ restarted: true });
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to restart Telegram bot",
		);
	}
}

export async function handleHealth(): Promise<Response> {
	return createSuccessResponse({
		status: "ok",
		timestamp: Date.now(),
		telegram: getGateway().isRunning(),
		configured: isEnvConfigured(),
	});
}

export async function handleAIStatus(): Promise<Response> {
	const preferences = getAiPreferences();
	const providers = preferences.providers;
	const model = preferences.selectedModelRef || "";
	const metadata = getResolvedAiModelMetadata(
		preferences.selectedModelRef || preferences.effectiveModelRef,
	);
	const configured =
		providers.openrouter.configured || providers["openai-codex"].configured;
	const activeProvider = configured
		? metadata?.provider ||
			(providers["openai-codex"].configured ? "openai-codex" : "openrouter")
		: undefined;

	let errorMessage: string | undefined;
	if (!configured) {
		errorMessage = "Connect OpenRouter or ChatGPT Plus to start the agent";
	}

	return createSuccessResponse({
		provider: activeProvider,
		model: preferences.effectiveModelRef || model,
		selectedModelRef: preferences.selectedModelRef,
		selectedProviderId: preferences.selectedProviderId,
		effectiveModelRef: preferences.effectiveModelRef,
		thinkingLevel: preferences.thinkingLevel,
		configured,
		hasAuthError: !configured,
		errorMessage,
		metadata,
		providers,
		chatgptLogin: getChatGptLoginState(),
	});
}

export async function handleAiPreferences(request: Request): Promise<Response> {
	if (request.method === "GET") {
		return createSuccessResponse(getAiPreferences());
	}

	try {
		const input = (await request.json()) as {
			modelRef?: string | null;
			thinkingLevel?: string | null;
		};
		const preferences = await updateAiPreferences({
			modelRef: input.modelRef,
			thinkingLevel: input.thinkingLevel as ThinkingLevel | null | undefined,
		});
		return createSuccessResponse(preferences);
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to update AI preferences",
		);
	}
}

export async function handleChatGptLogin(): Promise<Response> {
	try {
		const state = await startChatGptLogin();
		return createSuccessResponse({
			provider: "openai-codex",
			state,
			configured: getAiProviders()["openai-codex"].configured,
		});
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to start ChatGPT login",
		);
	}
}

function mapBuiltinModelsToAiOptions(
	provider: AiProviderId,
	models: Array<{
		id: string;
		name: string;
		provider: string;
		baseUrl?: string;
		api?: string;
		contextWindow?: number;
		maxTokens?: number;
		reasoning: boolean;
	}>,
	selectedModelRef?: string,
): AiModelOption[] {
	return models.map((model) => ({
		ref: `${model.provider}/${model.id}`,
		provider,
		modelId: model.id,
		name: model.name,
		baseUrl: model.baseUrl,
		api: model.api,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		reasoning: model.reasoning,
		selected: selectedModelRef === `${model.provider}/${model.id}`,
	}));
}

export async function handleAiModels(request: Request): Promise<Response> {
	try {
		const provider =
			new URL(request.url).searchParams.get("provider") === "openai-codex"
				? "openai-codex"
				: "openrouter";
		const selectedModelRef = getAiPreferences().selectedModelRef;
		const models = mapBuiltinModelsToAiOptions(
			provider,
			getBuiltinModels(provider),
			selectedModelRef,
		);
		return createSuccessResponse({
			provider,
			configured: getAiProviders()[provider].configured,
			models,
		} satisfies AiProviderModelsResponse);
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to load model metadata",
		);
	}
}
