/**
 * HTTP Route Handlers
 *
 * Configuration, status, and Telegram management only.
 */

import {
	getAllEnvVarsWithMetadata,
	getEnvFileContent,
	getEnvSchema,
	getEnvStatus,
	getEnvVar,
	isEnvConfigured,
	loadEnvFile,
	updateManyEnvVars,
	validateEnv,
} from "./env.js";
import { getGateway } from "./gateway/manager.js";
import {
	getActiveModelMetadata,
	getOpenRouterModelRegistry,
} from "./openrouter.js";
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
		if (getEnvVar("OPENROUTER_API_KEY")) {
			void getOpenRouterModelRegistry()
				.refresh()
				.catch((err) => {
					console.warn("[Config] Failed to refresh OpenRouter metadata:", err);
				});
		}

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
		if ("OPENROUTER_API_KEY" in updates || "AI_MODEL" in updates) {
			void getOpenRouterModelRegistry()
				.refresh()
				.catch((err) => {
					console.warn("[Config] Failed to refresh OpenRouter metadata:", err);
				});
		}
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

	if (!telegramChannel) {
		return createSuccessResponse({
			name: "telegram",
			enabled: false,
			running: false,
			configured: false,
			error: "Telegram channel not configured",
		});
	}

	return createSuccessResponse(telegramChannel.getStatus());
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
	const model = getEnvVar("AI_MODEL") || "";
	const hasKey = !!getEnvVar("OPENROUTER_API_KEY");
	const envStatus = getEnvStatus();
	const metadata = hasKey && model ? await getActiveModelMetadata() : null;

	let errorMessage: string | undefined;
	if (!hasKey && model) {
		errorMessage = "No OpenRouter API key configured";
	} else if (!model && hasKey) {
		errorMessage = "No model configured";
	} else if (envStatus.migrationMessage) {
		errorMessage = envStatus.migrationMessage;
	}

	return createSuccessResponse({
		provider: "openrouter",
		model,
		configured: hasKey && !!model,
		hasAuthError: !hasKey && !!model,
		errorMessage,
		metadata,
		legacyDetected: envStatus.legacyDetected,
	});
}

export async function handleOpenRouterModels(): Promise<Response> {
	try {
		const registry = getOpenRouterModelRegistry();
		if (registry.getStatus().count === 0 && getEnvVar("OPENROUTER_API_KEY")) {
			await registry.refresh();
		}
		const models = registry.getAllModels();
		return createSuccessResponse({
			models,
			lastRefreshedAt: registry.getStatus().lastRefreshedAt,
		});
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to load model metadata",
		);
	}
}
