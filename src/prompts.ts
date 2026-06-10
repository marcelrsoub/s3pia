import { workspacePath } from "./workspace.js";

const WORKSPACE = workspacePath();

/**
 * Clear the cached workspace context.
 * Call this after background tasks modify workspace files.
 */
export function clearWorkspaceContextCache(): void {
	cachedWorkspaceContext = null;
	console.log("[Prompts] Workspace context cache cleared");
}

// Cache for workspace context files
let cachedWorkspaceContext: string | null = null;

/**
 * Load workspace context files (IDENTITY.md, SOUL.md, USER.md, BOOTSTRAP.md)
 * These files define the bot's personality, who the user is, and other important context
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
		"## SYSTEM STATUS\n\nTelegram is the only user-facing channel. Use `send_message` to reply to the configured admin chat.\n\nYou are running inside Docker. You can use only the ports and services already exposed by the container, and you cannot publish new host ports from inside the task. If something needs to be reachable externally, ask for an external container or compose change.",
	);

	const result = contextParts.join("\n\n");
	cachedWorkspaceContext = result;
	return result;
}
