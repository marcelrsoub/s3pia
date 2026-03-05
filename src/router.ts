/**
 * HTTP Route Handlers
 *
 * Simplified router for SepiaBot API endpoints.
 * Handles chat, configuration, and tool management.
 */

import { Agent } from "./agent.js";
import { conversationStore, getConversationId } from "./conversation.js";
import {
	getAllEnvVars,
	getAllEnvVarsWithMetadata,
	getEnvSchema,
	getEnvStatus,
	getEnvVar,
	isEnvConfigured,
	updateManyEnvVars,
	validateEnv,
} from "./env.js";
import { getGateway } from "./gateway/manager.js";
import { reinitializeAdminUser } from "./telegram-auth.js";

// Types
interface ChatRequest {
	message: string;
	source?: "web" | "telegram";
	conversationId?: string;
}

interface ErrorResponse {
	error: string;
}

interface ChatResponse {
	reply: string;
}

/**
 * Create standardized error response
 */
function createErrorResponse(message: string, status = 500): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Create standardized success response
 */
function createSuccessResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// =============================================================================
// CHAT ENDPOINTS
// =============================================================================

/**
 * POST /chat - Simple chat endpoint
 */
export async function handleChat(request: Request): Promise<Response> {
	try {
		const body = (await request.json()) as ChatRequest;

		// Validate request
		if (!body.message || typeof body.message !== "string") {
			return createErrorResponse(
				'"message" field is required and must be a string',
				400,
			);
		}

		// Determine conversation ID
		const conversationId =
			body.source === "telegram" ? "telegram" : getConversationId(request);

		// Get or create conversation
		let conv = conversationStore.get(conversationId);
		if (!conv) {
			conv = conversationStore.create(conversationId);
		}

		// Get conversation history before adding new message
		const conversationHistory = conv.messages;

		// Add user message
		conversationStore.addMessage(
			conversationId,
			"user",
			body.message,
			body.source,
		);

		// Execute with Agent with conversation history
		const agent = new Agent();
		const result = await agent.execute(
			body.message,
			conversationHistory,
			body.source,
		);

		// Handle blocked state
		if (result.blocked) {
			return createSuccessResponse({
				reply: result.question || "I need more information to proceed.",
			});
		}

		// Add assistant response
		const reply = result.result || "Task completed";
		conversationStore.addMessage(
			conversationId,
			"assistant",
			reply,
			body.source,
		);

		// Broadcast to WebSocket clients
		const gateway = getGateway();
		const webChannel = gateway.getWebChannel();
		if (webChannel) {
			const fullHistory = conversationStore.getMessagesForAI(conversationId);
			webChannel.broadcast(conversationId, {
				type: "history",
				messages: fullHistory,
			});
		}

		return createSuccessResponse({ reply });
	} catch (err) {
		console.error("[handleChat] Error:", err);
		return createErrorResponse(
			err instanceof Error ? err.message : "Internal server error",
		);
	}
}

/**
 * POST /chat/stream - Streaming chat endpoint (SSE)
 */
export async function handleChatStream(request: Request): Promise<Response> {
	const body = (await request.json()) as ChatRequest;

	if (!body.message || typeof body.message !== "string") {
		return createErrorResponse('"message" field is required', 400);
	}

	// Create a readable stream for SSE
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				const conversationId = getConversationId(request);
				let conv = conversationStore.get(conversationId);
				if (!conv) {
					conv = conversationStore.create(conversationId);
				}

				conversationStore.addMessage(
					conversationId,
					"user",
					body.message,
					body.source,
				);

				// Execute agent
				const agent = new Agent();
				const result = await agent.execute(
					body.message,
					undefined,
					body.source,
				);

				const reply = result.blocked
					? result.question || "I need more information"
					: result.result || "Task completed";

				// Stream the response in chunks
				const chunkSize = 50;
				for (let i = 0; i < reply.length; i += chunkSize) {
					const chunk = reply.slice(i, i + chunkSize);
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`),
					);
				}

				// Send done signal
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
				);

				// Store response
				if (!result.blocked) {
					conversationStore.addMessage(
						conversationId,
						"assistant",
						reply,
						body.source,
					);
				}
			} catch (err) {
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({ error: "Processing failed" })}\n\n`,
					),
				);
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

// =============================================================================
// CONVERSATION ENDPOINTS
// =============================================================================

export async function handleGetConversation(
	request: Request,
): Promise<Response> {
	const conversationId = getConversationId(request);
	const conv = conversationStore.get(conversationId);

	return createSuccessResponse({
		conversationId,
		messages: conv?.messages || [],
	});
}

export async function handleGetConversations(): Promise<Response> {
	const conversations = conversationStore.list();
	return createSuccessResponse({ conversations });
}

export async function handleClearConversation(
	request: Request,
): Promise<Response> {
	const body = (await request.json()) as { conversationId?: string };
	const conversationId = body.conversationId || getConversationId(request);

	conversationStore.clear(conversationId);
	return createSuccessResponse({ cleared: true, conversationId });
}

// =============================================================================
// CONFIGURATION ENDPOINTS
// =============================================================================

/**
 * GET /api/config/env - Get current .env file content
 */
export async function handleGetEnv(): Promise<Response> {
	const { getEnvFileContent } = await import("./env.js");

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

/**
 * POST /api/config/env - Update .env file content
 */
export async function handleUpdateEnv(request: Request): Promise<Response> {
	try {
		const content = await request.text();

		if (!content) {
			return createErrorResponse("Content is required");
		}

		const ENV_FILE = "/app/ws/config/.env";
		const { loadEnvFile } = await import("./env.js");

		const oldEnv = await getAllEnvVars();

		await Bun.$`mkdir -p /app/ws/config`;
		await Bun.write(ENV_FILE, content);
		await loadEnvFile();

		const newEnv = await getAllEnvVars();
		const telegramKeys = [
			"TELEGRAM_BOT_TOKEN",
			"ADMIN_TELEGRAM_ID",
			"TELEGRAM_ENABLED",
		];
		const hasTelegramChanges = telegramKeys.some(
			(key) => oldEnv[key] !== newEnv[key],
		);

		if (hasTelegramChanges) {
			reinitializeAdminUser();
			const gateway = getGateway();
			await gateway.reinitializeTelegramChannel();
		}

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
	const status = getEnvStatus();
	return createSuccessResponse(status);
}

export async function handleConfigSchema(): Promise<Response> {
	const schema = getEnvSchema();
	return createSuccessResponse(schema);
}

export async function handleGetConfig(): Promise<Response> {
	const settings = await getAllEnvVarsWithMetadata();
	return createSuccessResponse({ settings });
}

export async function handleUpdateConfig(request: Request): Promise<Response> {
	try {
		const updates = await request.json();
		await updateManyEnvVars(updates);

		// Reinitialize Telegram if relevant config changed
		const telegramKeys = [
			"TELEGRAM_BOT_TOKEN",
			"ADMIN_TELEGRAM_ID",
			"TELEGRAM_ENABLED",
		];
		const hasTelegramChanges = telegramKeys.some((key) => key in updates);

		if (hasTelegramChanges) {
			reinitializeAdminUser();
			const gateway = getGateway();
			await gateway.reinitializeTelegramChannel();
		}

		return createSuccessResponse({ updated: true });
	} catch (err) {
		return createErrorResponse(
			err instanceof Error ? err.message : "Failed to update config",
		);
	}
}

export async function handleValidateConfig(): Promise<Response> {
	const validation = validateEnv();
	return createSuccessResponse(validation);
}

export async function handleTestZAIKey(request: Request): Promise<Response> {
	try {
		const { apiKey } = await request.json();

		// Simple validation check
		if (!apiKey || typeof apiKey !== "string") {
			return createSuccessResponse({
				valid: false,
				error: "Invalid API key format",
			});
		}

		// Try a simple API call
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

		const valid = response.ok;
		const error = valid
			? undefined
			: (await response.json())?.error?.message || "API call failed";

		return createSuccessResponse({ valid, error });
	} catch (err) {
		return createSuccessResponse({ valid: false, error: "Connection failed" });
	}
}

export async function handleTestConfig(request: Request): Promise<Response> {
	try {
		const { provider, apiKey } = (await request.json()) as {
			provider: string;
			apiKey: string;
		};

		// Simple validation check
		if (!apiKey || typeof apiKey !== "string") {
			return createSuccessResponse({
				valid: false,
				error: "Invalid API key format",
			});
		}

		// Provider-specific test endpoints
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

		// Try API call
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

		const valid = response.ok;

		return createSuccessResponse({
			valid,
			error: valid
				? undefined
				: (await response.json())?.error?.message || "API call failed",
		});
	} catch (err) {
		return createSuccessResponse({ valid: false, error: "Connection failed" });
	}
}

// =============================================================================
// TELEGRAM ENDPOINTS
// =============================================================================

export async function handleTelegramBotStatus(): Promise<Response> {
	const gateway = getGateway();
	const telegramChannel = gateway.getTelegramChannel();

	if (!telegramChannel) {
		return createSuccessResponse({
			running: false,
			error: "Telegram channel not configured",
		});
	}

	return createSuccessResponse(telegramChannel.getStatus());
}

export async function handleTelegramBotRestart(): Promise<Response> {
	try {
		const gateway = getGateway();
		const telegramChannel = gateway.getTelegramChannel();

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

// =============================================================================
// HEALTH ENDPOINTS
// =============================================================================

export async function handleHealth(): Promise<Response> {
	return createSuccessResponse({
		status: "ok",
		timestamp: Date.now(),
		gateway: getGateway().isRunning(),
		configured: isEnvConfigured(),
	});
}

// =============================================================================
// AI PROVIDER STATUS ENDPOINT
// =============================================================================

export async function handleAIStatus(): Promise<Response> {
	const provider = getEnvVar("AI_PROVIDER") || "zai";
	const model = getEnvVar("AI_MODEL") || "";

	// Map provider to its API key field
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
