import { expect, test } from "bun:test";
import { loadWorkspaceContext } from "../src/prompts";

test("includes a Docker runtime guardrail in the workspace context", async () => {
	const context = await loadWorkspaceContext();

	expect(context).toContain("# Bootstrap: Waking Up");
	expect(context).toContain("Telegram is the only user-facing channel.");
	expect(context).toContain("available message tool");
	expect(context).toContain("`files` parameter");
	expect(context).toContain("short paragraphs, bullets, numbered steps");
	expect(context).toContain("You are running inside Docker.");
	expect(context).toContain(
		"cannot publish new host ports from inside the run",
	);
	expect(context).toContain(
		"Talk like a capable human, not an internal dashboard or ticket system.",
	);
	expect(context).toContain("Treat follow-ups during active work as updates");
	expect(context).toContain("## UX_CONTRACT");
});
