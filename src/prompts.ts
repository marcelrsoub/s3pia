import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { LIVE_AGENT_POLICY, LIVE_SKILLS_POINTER } from "./agent-policy.js";
import { getSkills } from "./skills.js";
import { workspacePath } from "./workspace.js";

const WORKSPACE = workspacePath();

export const WORKSPACE_CONTEXT_FILES = [
	"IDENTITY.md",
	"SOUL.md",
	"USER.md",
] as const;

export const COACH_OS_CONTEXT_FILES = [
	{ filename: "Strategy Memory.md", required: true },
	{ filename: "Life Vision.md", required: false },
	{ filename: "Active Pillars.md", required: false },
	{ filename: "Current Goals.md", required: false },
	{ filename: "Current Campaign.md", required: true },
	{ filename: "Weekly Mission.md", required: true },
	{ filename: "Daily Logs.md", required: false },
	{ filename: "Reviews.md", required: false },
	{ filename: "Patterns.md", required: false },
	{ filename: "Metrics.md", required: false },
	{ filename: "Safety Limits.md", required: false },
	{ filename: "Coach Prompts.md", required: false },
] as const;

type WorkspaceContextOptions = {
	workspaceDir?: string;
};

export interface CoachOSContextValidationResult {
	ok: boolean;
	missingRequired: string[];
	unreadableRequired: string[];
	missingOptional: string[];
	unreadableOptional: string[];
}

export class CoachOSContextError extends Error {
	readonly missingRequired: string[];
	readonly unreadableRequired: string[];

	constructor(validation: CoachOSContextValidationResult) {
		const issues = [
			...validation.missingRequired.map((file) => `missing ${file}`),
			...validation.unreadableRequired.map((file) => `unreadable ${file}`),
		];
		super(
			issues.length > 0
				? `Coach OS context is unavailable: ${issues.join(", ")}`
				: "Coach OS context is unavailable",
		);
		this.name = "CoachOSContextError";
		this.missingRequired = validation.missingRequired;
		this.unreadableRequired = validation.unreadableRequired;
	}
}

interface CachedContextEntry {
	signature: string;
	content: string;
}

const workspaceContextCache = new Map<string, CachedContextEntry>();
const coachOSContextCache = new Map<string, CachedContextEntry>();

/**
 * Clear cached workspace and Coach OS context.
 * Call this after background work modifies workspace files.
 */
export function clearWorkspaceContextCache(): void {
	workspaceContextCache.clear();
	coachOSContextCache.clear();
	console.log("[Prompts] Workspace context cache cleared");
}

function resolveWorkspaceDir(workspaceDir: string | undefined): string {
	return resolve(workspaceDir || WORKSPACE);
}

function getFileSignature(filePath: string): string {
	if (!existsSync(filePath)) {
		return "missing";
	}

	try {
		const stats = statSync(filePath);
		return `${stats.size}:${stats.mtimeMs}`;
	} catch {
		return "unreadable";
	}
}

function getWorkspaceContextFilePath(
	workspaceDir: string,
	fileName: string,
): string {
	return join(workspaceDir, fileName);
}

function getCoachOSContextFilePath(
	workspaceDir: string,
	fileName: string,
): string {
	return join(workspaceDir, "Coach OS", fileName);
}

async function readWorkspaceMarkdownFile(
	filePath: string,
): Promise<string | null> {
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		return await Bun.file(filePath).text();
	} catch {
		return null;
	}
}

async function loadWorkspaceContextFromDir(
	workspaceDir: string,
): Promise<string> {
	const normalizedWorkspaceDir = resolveWorkspaceDir(workspaceDir);
	const signature = WORKSPACE_CONTEXT_FILES.map((fileName) => {
		const filePath = getWorkspaceContextFilePath(
			normalizedWorkspaceDir,
			fileName,
		);
		return `${fileName}:${getFileSignature(filePath)}`;
	}).join("|");

	const cached = workspaceContextCache.get(normalizedWorkspaceDir);
	if (cached?.signature === signature) {
		return cached.content;
	}

	const contextParts: string[] = [];

	for (const fileName of WORKSPACE_CONTEXT_FILES) {
		try {
			const filePath = getWorkspaceContextFilePath(
				normalizedWorkspaceDir,
				fileName,
			);
			const content = await readWorkspaceMarkdownFile(filePath);
			if (content) {
				const nameWithoutExt = fileName.replace(".md", "");
				contextParts.push(`## ${nameWithoutExt}\n${content}`);
				console.log(`[Prompts] Loaded workspace context: ${fileName}`);
			}
		} catch {
			// Skip missing or unreadable files.
		}
	}

	contextParts.push(LIVE_AGENT_POLICY);
	const skillsSummary = await getSkills().getSkillsSummary();
	contextParts.push(`## SKILLS\n\n${LIVE_SKILLS_POINTER}\n\n${skillsSummary}`);
	contextParts.push(
		"## SYSTEM STATUS\n\nYou are running inside Docker. You can use only the ports and services already exposed by the container, and you cannot publish new host ports from inside the run. If something needs to be reachable externally, ask for an external container or compose change.",
	);

	const result = contextParts.join("\n\n");
	workspaceContextCache.set(normalizedWorkspaceDir, {
		signature,
		content: result,
	});
	return result;
}

async function readCoachOSContextFromDir(workspaceDir: string): Promise<{
	content: string;
	validation: CoachOSContextValidationResult;
	signature: string;
}> {
	const normalizedWorkspaceDir = resolveWorkspaceDir(workspaceDir);
	const sections: string[] = [];
	const missingRequired: string[] = [];
	const unreadableRequired: string[] = [];
	const missingOptional: string[] = [];
	const unreadableOptional: string[] = [];

	const signature = COACH_OS_CONTEXT_FILES.map(({ filename }) => {
		const filePath = getCoachOSContextFilePath(
			normalizedWorkspaceDir,
			filename,
		);
		return `${filename}:${getFileSignature(filePath)}`;
	}).join("|");

	for (const { filename, required } of COACH_OS_CONTEXT_FILES) {
		const filePath = getCoachOSContextFilePath(
			normalizedWorkspaceDir,
			filename,
		);
		if (!existsSync(filePath)) {
			if (required) {
				missingRequired.push(filename);
			} else {
				missingOptional.push(filename);
			}
			continue;
		}

		try {
			const content = await Bun.file(filePath).text();
			sections.push(`## ${filename.replace(".md", "")}\n${content}`);
			console.log(`[Prompts] Loaded Coach OS context: ${filename}`);
		} catch {
			if (required) {
				unreadableRequired.push(filename);
			} else {
				unreadableOptional.push(filename);
			}
		}
	}

	return {
		content: sections.join("\n\n"),
		signature,
		validation: {
			ok: missingRequired.length === 0 && unreadableRequired.length === 0,
			missingRequired,
			unreadableRequired,
			missingOptional,
			unreadableOptional,
		},
	};
}

/**
 * Load the mutable workspace context that should remain available to the agent.
 */
export async function loadWorkspaceContext(
	options: WorkspaceContextOptions = {},
): Promise<string> {
	return loadWorkspaceContextFromDir(options.workspaceDir || WORKSPACE);
}

export async function validateCoachOSContext(
	workspaceDir = WORKSPACE,
): Promise<CoachOSContextValidationResult> {
	const { validation } = await readCoachOSContextFromDir(workspaceDir);
	return validation;
}

export async function loadCoachOSContext(
	workspaceDir = WORKSPACE,
): Promise<string> {
	const normalizedWorkspaceDir = resolveWorkspaceDir(workspaceDir);
	const { content, validation, signature } = await readCoachOSContextFromDir(
		normalizedWorkspaceDir,
	);

	if (!validation.ok) {
		throw new CoachOSContextError(validation);
	}

	const cached = coachOSContextCache.get(normalizedWorkspaceDir);
	if (cached?.signature === signature) {
		return cached.content;
	}

	coachOSContextCache.set(normalizedWorkspaceDir, { signature, content });
	return content;
}

export async function buildPlannerContext(
	workspaceDir = WORKSPACE,
): Promise<string> {
	const baseContext = await loadWorkspaceContext({ workspaceDir });
	const coachOSContext = await loadCoachOSContext(workspaceDir);

	return [
		baseContext,
		"## COACH OS PLANNER CONTEXT\n\nLoad and obey the Coach OS strategy context below before generating daily, weekly, or monthly coaching output. Do not invent generic coaching plans when required strategy files are missing.",
		coachOSContext,
	].join("\n\n");
}
