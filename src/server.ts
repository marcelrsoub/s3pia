import { basename } from "node:path";
import { servePublicPage } from "./public-pages.js";
import {
	handleAIStatus,
	handleAiModels,
	handleAiPreferences,
	handleChatGptLogin,
	handleConfigSchema,
	handleConfigStatus,
	handleGetConfig,
	handleGetEnv,
	handleHealth,
	handleTelegramBotRestart,
	handleTelegramBotStatus,
	handleTelegramLiveRunCancel,
	handleTestConfig,
	handleTestOpenRouterKey,
	handleUpdateConfig,
	handleUpdateEnv,
	handleValidateConfig,
} from "./router.js";
import { normalizeWorkspaceFilePath } from "./telegram-client.js";

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

function getMimeType(extension: string): string {
	const mimeTypes: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		webp: "image/webp",
		ico: "image/x-icon",
		pdf: "application/pdf",
		txt: "text/plain",
		md: "text/markdown",
		csv: "text/csv",
		json: "application/json",
		xml: "application/xml",
		js: "text/javascript",
		ts: "text/typescript",
		html: "text/html",
		css: "text/css",
		py: "text/x-python",
		rs: "text/x-rust",
		go: "text/x-go",
		zip: "application/zip",
		tar: "application/x-tar",
		gz: "application/gzip",
		"7z": "application/x-7z-compressed",
	};

	return mimeTypes[extension] || "application/octet-stream";
}

async function serveStatic(pathname: string): Promise<Response | null> {
	const filePath = pathname === "/" ? "/index.html" : pathname;
	const fullPath = `./frontend/dist${filePath}`;

	try {
		const file = Bun.file(fullPath);
		if (!(await file.exists())) {
			return null;
		}

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

export function startServer() {
	const server = Bun.serve({
		hostname: HOST,
		port: Number(PORT),
		idleTimeout: 255,
		async fetch(req) {
			const url = new URL(req.url);

			if (
				req.method === "GET" &&
				(url.pathname === "/pages" || url.pathname.startsWith("/pages/"))
			) {
				const publicPageResponse = await servePublicPage(url.pathname);
				if (publicPageResponse) {
					return publicPageResponse;
				}
			}

			if (req.method === "GET") {
				const staticResponse = await serveStatic(url.pathname);
				if (staticResponse) {
					return staticResponse;
				}
			}

			if (req.method === "GET" && url.pathname.startsWith("/images/")) {
				return serveWorkspaceFile(url.pathname.replace("/images/", ""), true);
			}

			if (req.method === "GET" && url.pathname.startsWith("/files/")) {
				return serveWorkspaceFile(url.pathname.replace("/files/", ""), false);
			}

			if (url.pathname === "/health" && req.method === "GET") {
				return handleHealth();
			}

			if (url.pathname === "/api/config/status" && req.method === "GET") {
				return handleConfigStatus();
			}
			if (url.pathname === "/api/config/schema" && req.method === "GET") {
				return handleConfigSchema();
			}
			if (url.pathname === "/api/config" && req.method === "GET") {
				return handleGetConfig();
			}
			if (url.pathname === "/api/config" && req.method === "POST") {
				return handleUpdateConfig(req);
			}
			if (url.pathname === "/api/config/validate" && req.method === "POST") {
				return handleValidateConfig();
			}
			if (
				url.pathname === "/api/config/test/openrouter" &&
				req.method === "POST"
			) {
				return handleTestOpenRouterKey(req);
			}
			if (url.pathname === "/api/config/test" && req.method === "POST") {
				return handleTestConfig(req);
			}
			if (url.pathname === "/api/config/env" && req.method === "GET") {
				return handleGetEnv();
			}
			if (url.pathname === "/api/config/env" && req.method === "POST") {
				return handleUpdateEnv(req);
			}
			if (url.pathname === "/api/ai/status" && req.method === "GET") {
				return handleAIStatus();
			}
			if (
				url.pathname === "/api/ai/preferences" &&
				(req.method === "GET" || req.method === "POST")
			) {
				return handleAiPreferences(req);
			}
			if (url.pathname === "/api/ai/login/chatgpt" && req.method === "POST") {
				return handleChatGptLogin();
			}
			if (url.pathname === "/api/ai/models" && req.method === "GET") {
				return handleAiModels(req);
			}
			if (url.pathname === "/api/telegram/status" && req.method === "GET") {
				return handleTelegramBotStatus();
			}
			if (url.pathname === "/api/telegram/restart" && req.method === "POST") {
				return handleTelegramBotRestart();
			}
			if (url.pathname === "/api/telegram/cancel" && req.method === "POST") {
				return handleTelegramLiveRunCancel();
			}

			return new Response(JSON.stringify({ error: "Not Found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		},
	});

	console.log(`HTTP server listening on http://localhost:${server.port}`);
	return server;
}

async function serveWorkspaceFile(
	requestedPath: string,
	inline: boolean,
): Promise<Response> {
	const decodedPath = decodeURIComponent(requestedPath);
	const normalizedPath = normalizeWorkspaceFilePath(decodedPath);
	if (!normalizedPath) {
		return new Response(JSON.stringify({ error: "Invalid path" }), {
			status: 403,
			headers: { "Content-Type": "application/json" },
		});
	}

	const file = Bun.file(normalizedPath);
	if (!(await file.exists())) {
		return new Response(JSON.stringify({ error: "File not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	const extension = decodedPath.split(".").pop()?.toLowerCase() || "";
	const filename = basename(normalizedPath).replace(/["\r\n]/g, "_");
	return new Response(file, {
		headers: {
			"Content-Type": getMimeType(extension),
			"Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
		},
	});
}
