import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { workspacePath } from "./workspace.js";

export const PUBLIC_PAGES_ROOT = workspacePath("public_pages");

const MIME_TYPES: Record<string, string> = {
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "application/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	ico: "image/x-icon",
};

function getContentType(filePath: string): string {
	const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
	return MIME_TYPES[extension] ?? "application/octet-stream";
}

function createTextResponse(message: string, status: number): Response {
	return new Response(message, {
		status,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

function resolvePublicPagePath(
	requestPath: string,
	rootDir: string,
): string | "invalid" | null {
	if (requestPath !== "/pages" && !requestPath.startsWith("/pages/")) {
		return null;
	}

	const root = resolve(rootDir);
	const relativePath = requestPath
		.replace(/^\/pages\/?/, "")
		.replace(/^\/+/, "");

	const candidate = resolve(root, relativePath);
	const pathInsideRoot = relative(root, candidate);

	if (
		pathInsideRoot.startsWith("..") ||
		(pathInsideRoot === "" && candidate !== root)
	) {
		return "invalid";
	}

	if (existsSync(candidate) && statSync(candidate).isDirectory()) {
		return join(candidate, "index.html");
	}

	return candidate;
}

export async function servePublicPage(
	requestPath: string,
	rootDir = PUBLIC_PAGES_ROOT,
): Promise<Response | null> {
	const resolvedPath = resolvePublicPagePath(requestPath, rootDir);
	if (!resolvedPath) {
		return null;
	}
	if (resolvedPath === "invalid") {
		return createTextResponse("Invalid path", 403);
	}

	if (!existsSync(resolvedPath)) {
		return createTextResponse("Page not found", 404);
	}

	if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
		return createTextResponse("Page not found", 404);
	}

	return new Response(Bun.file(resolvedPath), {
		headers: {
			"Content-Type": getContentType(resolvedPath),
		},
	});
}
