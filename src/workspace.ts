import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DOCKER_WORKSPACE = "/app/ws";
const LOCAL_WORKSPACE = resolve(process.cwd(), "ws");

export const WORKSPACE_ROOT = existsSync(DOCKER_WORKSPACE)
	? DOCKER_WORKSPACE
	: LOCAL_WORKSPACE;

export function workspacePath(...segments: string[]): string {
	return join(WORKSPACE_ROOT, ...segments);
}

export function isWorkspacePath(path: string): boolean {
	const resolvedPath = resolve(path);
	const resolvedRoot = resolve(WORKSPACE_ROOT);
	return (
		resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`)
	);
}
