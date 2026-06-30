import { LIVE_AGENT_POLICY, LIVE_SKILLS_POINTER } from "./agent-policy.js";
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
 * Load the mutable workspace context that should remain available to the agent.
 */
export async function loadWorkspaceContext(): Promise<string> {
	// Return cached value if available
	if (cachedWorkspaceContext) {
		return cachedWorkspaceContext;
	}

	const contextParts: string[] = [];

	// Load identity and personality files
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

	contextParts.push(LIVE_AGENT_POLICY);
	const skillsSummary = await getSkills().getSkillsSummary();
	contextParts.push(
		`## SKILLS\n\n${LIVE_SKILLS_POINTER}\n\n${skillsSummary}`,
	);
	contextParts.push(
		"## SYSTEM STATUS\n\nYou are running inside Docker. You can use only the ports and services already exposed by the container, and you cannot publish new host ports from inside the run. If something needs to be reachable externally, ask for an external container or compose change.",
	);

	const result = contextParts.join("\n\n");
	cachedWorkspaceContext = result;
	return result;
}
