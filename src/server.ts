import { getGateway } from "./gateway/manager.js";
import {
	handleAIStatus,
	handleChat,
	handleChatStream,
	handleClearConversation,
	handleConfigSchema,
	handleConfigStatus,
	handleGetConfig,
	handleGetConversation,
	handleGetConversations,
	handleGetEnv,
	handleHealth,
	handleTelegramBotRestart,
	handleTelegramBotStatus,
	handleTestConfig,
	handleTestZAIKey,
	handleUpdateConfig,
	handleUpdateEnv,
	handleValidateConfig,
} from "./router";

const PORT = process.env.PORT || 3000;

/**
 * Get MIME type based on file extension
 * Supports common file types for download
 */
function getMimeType(extension: string): string {
	const mimeTypes: Record<string, string> = {
		// Images
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		ico: "image/x-icon",

		// Documents
		pdf: "application/pdf",
		txt: "text/plain",
		md: "text/markdown",
		csv: "text/csv",
		json: "application/json",
		xml: "application/xml",

		// Code
		js: "text/javascript",
		ts: "text/typescript",
		html: "text/html",
		css: "text/css",
		py: "text/x-python",
		rs: "text/x-rust",
		go: "text/x-go",

		// Archives
		zip: "application/zip",
		tar: "application/x-tar",
		gz: "application/gzip",
		"7z": "application/x-7z-compressed",
	};

	return mimeTypes[extension] || "application/octet-stream";
}

// Helper to serve static files from frontend/dist
async function serveStatic(pathname: string): Promise<Response | null> {
	const filePath = pathname === "/" ? "/index.html" : pathname;
	const fullPath = `./frontend/dist${filePath}`;

	try {
		const file = Bun.file(fullPath);
		const exists = await file.exists();
		if (!exists) {
			return null;
		}

		// Set appropriate content type
		let contentType = "text/html";
		if (filePath.endsWith(".js")) {
			contentType = "application/javascript";
		} else if (filePath.endsWith(".css")) {
			contentType = "text/css";
		} else if (filePath.endsWith(".json")) {
			contentType = "application/json";
		} else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico)$/)) {
			contentType = `image/${filePath.split(".").pop()}`;
		}

		return new Response(file, {
			headers: { "Content-Type": contentType },
		});
	} catch {
		return null;
	}
}

// Start HTTP server using Bun.serve()
export function startServer() {
	// Get WebSocket handler from WebChannel
	const gateway = getGateway();
	const webChannel = gateway.getWebChannel();
	const wsHandler = webChannel?.getHandler();

	const server = Bun.serve({
		port: Number(PORT),
		// Increase timeout for long-running AI streaming (max 255 seconds)
		idleTimeout: 255,
		websocket: wsHandler,
		async fetch(req, server) {
			const url = new URL(req.url);

			// Serve frontend static files (try any GET request first)
			if (req.method === "GET") {
				const staticResponse = await serveStatic(url.pathname);
				if (staticResponse) {
					return staticResponse;
				}
			}

			// Serve images from ws directory
			if (req.method === "GET" && url.pathname.startsWith("/images/")) {
				const imagePath = url.pathname.replace("/images/", "");
				const fullPath = `./ws/${imagePath}`;

				try {
					const file = Bun.file(fullPath);
					const exists = await file.exists();
					if (exists) {
						return new Response(file, {
							headers: { "Content-Type": "image/png" },
						});
					}
				} catch {
					// File doesn't exist or error reading
				}
				return new Response(JSON.stringify({ error: "Image not found" }), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				});
			}

			// Serve files from ws directory (all file types for download)
			if (req.method === "GET" && url.pathname.startsWith("/files/")) {
				const filePath = url.pathname.replace("/files/", "");
				const fullPath = `./ws/${filePath}`;

				// Security: Prevent path traversal attacks
				const _normalizedPath = filePath
					.replace(/\.\./g, "")
					.replace(/\\/g, "/");

				// Ensure path stays within ws/ directory
				if (filePath.includes("..")) {
					return new Response(JSON.stringify({ error: "Invalid path" }), {
						status: 403,
						headers: { "Content-Type": "application/json" },
					});
				}

				try {
					const file = Bun.file(fullPath);
					const exists = await file.exists();

					if (!exists) {
						return new Response(JSON.stringify({ error: "File not found" }), {
							status: 404,
							headers: { "Content-Type": "application/json" },
						});
					}

					// Determine MIME type based on file extension
					const ext = filePath.split(".").pop()?.toLowerCase() || "";
					const mimeType = getMimeType(ext);

					// Set Content-Disposition for download
					const filename = filePath.split("/").pop() || "download";
					const headers: Record<string, string> = {
						"Content-Type": mimeType,
						"Content-Disposition": `attachment; filename="${filename}"`,
					};

					return new Response(file, { headers });
				} catch (err) {
					return new Response(
						JSON.stringify({
							error: "Error reading file",
							details: err instanceof Error ? err.message : "Unknown error",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			}

			// WebSocket upgrade - /ws
			if (url.pathname === "/ws") {
				return server.upgrade(req);
			}

			// POST /chat/stream - Streaming endpoint
			if (url.pathname === "/chat/stream" && req.method === "POST") {
				return handleChatStream(req);
			}

			// POST /chat - Non-streaming endpoint
			if (url.pathname === "/chat" && req.method === "POST") {
				return handleChat(req);
			}

			// GET /health
			if (url.pathname === "/health" && req.method === "GET") {
				return handleHealth();
			}

			// POST /conversation/clear - Clear conversation history
			if (url.pathname === "/conversation/clear" && req.method === "POST") {
				return handleClearConversation(req);
			}

			// GET /conversation - Get conversation history
			if (url.pathname === "/conversation" && req.method === "GET") {
				return handleGetConversation(req);
			}

			// =============================================================================
			// CONFIGURATION API ROUTES
			// =============================================================================

			// GET /api/config/status - Check if system is configured
			if (url.pathname === "/api/config/status" && req.method === "GET") {
				return handleConfigStatus();
			}

			// GET /api/config/schema - Get configuration schema
			if (url.pathname === "/api/config/schema" && req.method === "GET") {
				return handleConfigSchema();
			}

			// GET /api/config - Get all settings (secrets masked)
			if (url.pathname === "/api/config" && req.method === "GET") {
				return handleGetConfig();
			}

			// POST /api/config - Update settings
			if (url.pathname === "/api/config" && req.method === "POST") {
				return handleUpdateConfig(req);
			}

			// POST /api/config/validate - Validate provided configuration
			if (url.pathname === "/api/config/validate" && req.method === "POST") {
				return handleValidateConfig(req);
			}

			// POST /api/config/test/zai - Test Z.AI API key
			if (url.pathname === "/api/config/test/zai" && req.method === "POST") {
				return handleTestZAIKey(req);
			}

			// POST /api/config/test - Test any provider API key
			if (url.pathname === "/api/config/test" && req.method === "POST") {
				return handleTestConfig(req);
			}

			// GET /api/config/env - Get current .env file content
			if (url.pathname === "/api/config/env" && req.method === "GET") {
				return handleGetEnv();
			}

			// POST /api/config/env - Update .env file content
			if (url.pathname === "/api/config/env" && req.method === "POST") {
				return handleUpdateEnv(req);
			}

			// =============================================================================
			// AI PROVIDER STATUS ROUTES
			// =============================================================================

			// GET /api/ai/status - Get AI provider status
			if (url.pathname === "/api/ai/status" && req.method === "GET") {
				return handleAIStatus();
			}

			// =============================================================================
			// CONVERSATIONS API ROUTES
			// =============================================================================

			// GET /api/conversations - List all available conversations
			if (url.pathname === "/api/conversations" && req.method === "GET") {
				return handleGetConversations();
			}

			// =============================================================================
			// TELEGRAM BOT MANAGEMENT ROUTES
			// =============================================================================

			// GET /api/telegram/status - Get Telegram bot status
			if (url.pathname === "/api/telegram/status" && req.method === "GET") {
				return handleTelegramBotStatus();
			}

			// POST /api/telegram/restart - Restart Telegram bot
			if (url.pathname === "/api/telegram/restart" && req.method === "POST") {
				return handleTelegramBotRestart();
			}

			// 404 Not Found
			return new Response(JSON.stringify({ error: "Not Found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		},
	});

	console.log(`HTTP server listening on http://localhost:${server.port}`);
	console.log(`Web UI available at http://localhost:${server.port}`);

	return server;
}
