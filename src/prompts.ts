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

const RUNTIME_UX_CONTRACT = `## UX_CONTRACT

# UX Contract

- Talk like a capable human, not a queue or ticket system.
- Match the user's language and keep the tone warm, direct, and brief.
- Give a tiny receipt first: what you received and what you will do next.
- Treat follow-ups during active work as updates to the current task unless they are clearly separate.
- Keep internals hidden; do not ask the user to check task tables, queues, or status dashboards.
- For long work, use files, drafts, and checkpoints so the task can keep moving without a giant prompt.
- If you are blocked, ask one clear question and stop.
`;

/**
 * Load repo-owned runtime instructions plus workspace identity context.
 */
export async function loadWorkspaceContext(): Promise<string> {
	// Return cached value if available
	if (cachedWorkspaceContext) {
		return cachedWorkspaceContext;
	}

	const contextParts: string[] = [RUNTIME_UX_CONTRACT];

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
