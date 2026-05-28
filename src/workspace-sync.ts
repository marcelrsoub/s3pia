import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceSyncResult {
	copiedFiles: string[];
}

function isSyncableSkillFile(filename: string): boolean {
	return filename.endsWith(".md") && !filename.startsWith("_");
}

async function copyFileIfMissing(sourcePath: string, destinationPath: string): Promise<boolean> {
	if (existsSync(destinationPath)) {
		return false;
	}

	const content = await Bun.file(sourcePath).text();
	await Bun.write(destinationPath, content);
	return true;
}

export async function syncDefaultWorkspaceFiles(
	workspaceDir = "/app/ws",
	templateDir = "/app/ws-template",
): Promise<WorkspaceSyncResult> {
	const copiedFiles: string[] = [];
	const templateSkillsDir = join(templateDir, "skills");
	const workspaceSkillsDir = join(workspaceDir, "skills");

	mkdirSync(workspaceSkillsDir, { recursive: true });

	if (!existsSync(templateSkillsDir)) {
		return { copiedFiles };
	}

	for (const entry of readdirSync(templateSkillsDir)) {
		if (!isSyncableSkillFile(entry)) {
			continue;
		}

		const sourcePath = join(templateSkillsDir, entry);
		const destinationPath = join(workspaceSkillsDir, entry);
		const copied = await copyFileIfMissing(sourcePath, destinationPath);

		if (copied) {
			copiedFiles.push(`skills/${entry}`);
		}
	}

	return { copiedFiles };
}
