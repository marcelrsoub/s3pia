import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { workspacePath } from "./workspace.js";

export interface WorkspaceSyncResult {
	copiedFiles: string[];
}

export interface WorkspaceSyncEnvironment {
	existsSync(path: string): boolean;
	mkdirSync(path: string, options?: { recursive?: boolean }): void;
	readdirSync(path: string): string[];
	readTextFile(path: string): Promise<string>;
	writeTextFile(path: string, content: string): Promise<void>;
}

function isSyncableSkillFile(filename: string): boolean {
	return filename.endsWith(".md") && !filename.startsWith("_");
}

const ROOT_TEMPLATE_FILES = [
	"BOOTSTRAP.md",
	"IDENTITY.md",
	"SOUL.md",
	"USER.md",
] as const;

export const defaultWorkspaceSyncEnvironment: WorkspaceSyncEnvironment = {
	existsSync,
	mkdirSync,
	readdirSync,
	readTextFile: (path: string) => Bun.file(path).text(),
	writeTextFile: async (path: string, content: string) => {
		await Bun.write(path, content);
	},
};

async function copyFileIfMissing(
	env: WorkspaceSyncEnvironment,
	sourcePath: string,
	destinationPath: string,
): Promise<boolean> {
	if (env.existsSync(destinationPath)) {
		return false;
	}

	const content = await env.readTextFile(sourcePath);
	await env.writeTextFile(destinationPath, content);
	return true;
}

export async function syncDefaultWorkspaceFiles(
	workspaceDir = workspacePath(),
	templateDir = existsSync("/app/ws-template")
		? "/app/ws-template"
		: resolve(process.cwd(), "ws"),
	env: WorkspaceSyncEnvironment = defaultWorkspaceSyncEnvironment,
): Promise<WorkspaceSyncResult> {
	const copiedFiles: string[] = [];
	env.mkdirSync(workspaceDir, { recursive: true });
	const templateSkillsDir = join(templateDir, "skills");
	const workspaceSkillsDir = join(workspaceDir, "skills");

	env.mkdirSync(workspaceSkillsDir, { recursive: true });

	if (env.existsSync(templateSkillsDir)) {
		for (const entry of env.readdirSync(templateSkillsDir)) {
			if (!isSyncableSkillFile(entry)) {
				continue;
			}

			const sourcePath = join(templateSkillsDir, entry);
			const destinationPath = join(workspaceSkillsDir, entry);
			const copied = await copyFileIfMissing(env, sourcePath, destinationPath);

			if (copied) {
				copiedFiles.push(`skills/${entry}`);
			}
		}
	}

	for (const entry of ROOT_TEMPLATE_FILES) {
		const sourcePath = join(templateDir, entry);
		if (!env.existsSync(sourcePath)) {
			continue;
		}
		const destinationPath = join(workspaceDir, entry);
		const copied = await copyFileIfMissing(env, sourcePath, destinationPath);
		if (copied) {
			copiedFiles.push(entry);
		}
	}

	return { copiedFiles };
}
