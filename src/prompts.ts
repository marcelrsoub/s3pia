import { getSkills } from "./skills.js";
import { workspacePath } from "./workspace.js";

const WORKSPACE = workspacePath();

/**
 * Clear the cached workspace context.
 * Call this after background work modifies workspace files.
 */
export function clearWorkspaceContextCache(): void {
	cachedWorkspaceContext = null;
	console.log("[Prompts] Workspace context cache cleared");
}

// Cache for workspace context files
let cachedWorkspaceContext: string | null = null;

/**
 * Load workspace context files (BOOTSTRAP.md, IDENTITY.md, SOUL.md, USER.md).
 * These are the agent-visible workspace seeds and mutable context.
 */
export async function loadWorkspaceContext(): Promise<string> {
	// Return cached value if available
	if (cachedWorkspaceContext) {
		return cachedWorkspaceContext;
	}

	const contextParts: string[] = [];

	// Load files in order (BOOTSTRAP first for onboarding)
	const bootstrapFile = Bun.file(`${WORKSPACE}/BOOTSTRAP.md`);
	if (await bootstrapFile.exists()) {
		const content = await bootstrapFile.text();
		contextParts.push(`## BOOTSTRAP\n${content}`);
		console.log("[Prompts] Loaded BOOTSTRAP.md");
	}

	// Then load identity and personality files
	const contextFiles = ["IDENTITY.md", "SOUL.md", "USER.md"];

	for (const fileName of contextFiles) {
		try {
			const filePath = `${WORKSPACE}/${fileName}`;
			const file = Bun.file(filePath);
			const exists = await file.exists();
			if (exists) {
				const content = await file.text();
				const nameWithoutExt = fileName.replace(".md", "");
				contextParts.push(`## ${nameWithoutExt}\n${content}`);
				console.log(`[Prompts] Loaded workspace context: ${fileName}`);
			}
		} catch (_err) {
			// File doesn't exist or can't be read, skip
		}
	}

	contextParts.push(
		"## SYSTEM STATUS\n\nTelegram is the only user-facing channel. Use the available message tool to reply to the configured admin chat. If the user should see an image or file, attach workspace paths with the `files` parameter instead of only mentioning them in text. Keep replies mobile-friendly: short paragraphs, bullets, numbered steps, and one idea per line.\n\nYou are running inside Docker. You can use only the ports and services already exposed by the container, and you cannot publish new host ports from inside the run. If something needs to be reachable externally, ask for an external container or compose change.",
	);

	const skillsSummary = await getSkills().getSkillsSummary();
	if (skillsSummary && skillsSummary !== "No skills available.") {
		contextParts.push(
			`## AVAILABLE SKILLS\n\n${skillsSummary}\n\nRead the relevant skill file when you need the detailed workflow or tool-specific guidance.`,
		);
	}

	const result = contextParts.join("\n\n");
	cachedWorkspaceContext = result;
	return result;
}
