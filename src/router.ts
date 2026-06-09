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

export async function handleTestZAIKey(request: Request): Promise<Response> {
	try {
		const { apiKey } = (await request.json()) as { apiKey?: string };
		if (!apiKey || typeof apiKey !== "string") {
			return createSuccessResponse({
				valid: false,
				error: "Invalid API key format",
			});
		}

		const response = await fetch(
			"https://api.z.ai/api/coding/paas/v4/chat/completions",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: "glm-4.7",
					messages: [{ role: "user", content: "test" }],
					max_tokens: 10,
				}),
			},
		);

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

export async function handleTestConfig(request: Request): Promise<Response> {
	try {
		const { provider, apiKey } = (await request.json()) as {
			provider?: string;
			apiKey?: string;
		};

		if (!provider || !apiKey || typeof apiKey !== "string") {
			return createSuccessResponse({
				valid: false,
				error: "Invalid provider or API key format",
			});
		}

		const testEndpoints: Record<string, string> = {
			zai: "https://api.z.ai/api/coding/paas/v4/chat/completions",
			openrouter: "https://openrouter.ai/api/v1/models",
			anthropic: "https://api.anthropic.com/v1/messages",
			openai: "https://api.openai.com/v1/models",
			deepseek: "https://api.deepseek.com/v1/models",
			groq: "https://api.groq.com/openai/v1/models",
			gemini: "https://generativelanguage.googleapis.com/v1/models",
		};

		const endpoint = testEndpoints[provider];
		if (!endpoint) {
			return createSuccessResponse({ valid: false, error: "Unknown provider" });
		}

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: provider === "zai" ? "glm-4.7" : "test",
				messages: [{ role: "user", content: "test" }],
				max_tokens: 10,
			}),
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
	const provider = getEnvVar("AI_PROVIDER") || "zai";
	const model = getEnvVar("AI_MODEL") || "";

	const providerKeyField: Record<string, string> = {
		zai: "ZAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
		groq: "GROQ_API_KEY",
		gemini: "GEMINI_API_KEY",
	};

	const keyField = providerKeyField[provider] || "ZAI_API_KEY";
	const hasKey = !!getEnvVar(keyField);
	const isConfigured = isEnvConfigured();

	let errorMessage: string | undefined;
	if (!hasKey && isConfigured) {
		errorMessage = `No API key configured for ${provider.toUpperCase()}`;
	} else if (!model && hasKey) {
		errorMessage = "No model configured";
	}

	return createSuccessResponse({
		provider,
		model,
		configured: hasKey && !!model,
		hasAuthError: !hasKey && isConfigured,
		errorMessage,
	});
}
