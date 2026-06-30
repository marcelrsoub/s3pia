import { expect, test } from "bun:test";
import { loadWorkspaceContext } from "../src/prompts";

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
