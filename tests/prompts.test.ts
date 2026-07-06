import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	buildPlannerContext,
	loadCoachOSContext,
	loadWorkspaceContext,
	validateCoachOSContext,
} from "../src/prompts";

async function createCoachOSTestWorkspace(
	fileMap: Record<string, string>,
): Promise<string> {
	const workspaceDir = join(
		"/tmp",
		`coach-os-test-${crypto.randomUUID()}`,
	);
	await Bun.$`mkdir -p ${join(workspaceDir, "Coach OS")}`;
	for (const [filename, content] of Object.entries(fileMap)) {
		await Bun.write(join(workspaceDir, "Coach OS", filename), content);
	}
	return workspaceDir;
}

test("includes a Docker runtime guardrail in the workspace context", async () => {
	const context = await loadWorkspaceContext();

	expect(context).toContain("## LIVE TELEGRAM POLICY");
	expect(context).toContain("Telegram is the only user-facing channel.");
	expect(context).not.toContain("# Bootstrap: Waking Up");
	expect(context).not.toContain("AVAILABLE SKILLS");
	expect(context).not.toContain("available message tool");
	expect(context).toContain("You are running inside Docker.");
	expect(context).toContain(
		"cannot publish new host ports from inside the run",
	);
});

test("loads Coach OS strategy context when required files are present", async () => {
	const workspaceDir = await createCoachOSTestWorkspace({
		"Strategy Memory.md": "Strategy memory content",
		"Life Vision.md": "Life vision content",
		"Active Pillars.md": "Active pillars content",
		"Current Goals.md": "Current goals content",
		"Current Campaign.md": "Current campaign content",
		"Weekly Mission.md": "Weekly mission content",
		"Daily Logs.md": "Daily logs content",
		"Reviews.md": "Reviews content",
		"Patterns.md": "Patterns content",
		"Metrics.md": "Metrics content",
		"Safety Limits.md": "Safety limits content",
		"Coach Prompts.md": "Coach prompts content",
	});

	try {
		const validation = await validateCoachOSContext(workspaceDir);
		expect(validation.ok).toBe(true);
		expect(validation.missingRequired).toHaveLength(0);

		const context = await loadCoachOSContext(workspaceDir);
		expect(context).toContain("## Strategy Memory");
		expect(context).toContain("Strategy memory content");
		expect(context).toContain("## Current Campaign");
		expect(context).toContain("Current campaign content");
		expect(context).toContain("## Weekly Mission");
		expect(context).toContain("Weekly mission content");
		expect(context).toContain("## Daily Logs");
		expect(context).toContain("Daily logs content");
		expect(context).toContain("## Reviews");
		expect(context).toContain("Reviews content");
		expect(context).toContain("## Coach Prompts");
		expect(context).toContain("Coach prompts content");

		const plannerContext = await buildPlannerContext(workspaceDir);
		expect(plannerContext).toContain("## COACH OS PLANNER CONTEXT");
		expect(plannerContext).toContain("Current campaign content");
	} finally {
		await Bun.$`rm -rf ${workspaceDir}`;
	}
});

test("fails closed when a required Coach OS file is missing", async () => {
	const workspaceDir = await createCoachOSTestWorkspace({
		"Strategy Memory.md": "Strategy memory content",
		"Weekly Mission.md": "Weekly mission content",
	});

	try {
		const validation = await validateCoachOSContext(workspaceDir);
		expect(validation.ok).toBe(false);
		expect(validation.missingRequired).toContain("Current Campaign.md");

		await expect(buildPlannerContext(workspaceDir)).rejects.toThrow(
			/Current Campaign\.md/,
		);
		await expect(loadCoachOSContext(workspaceDir)).rejects.toThrow(
			/Current Campaign\.md/,
		);
	} finally {
		await Bun.$`rm -rf ${workspaceDir}`;
	}
});
