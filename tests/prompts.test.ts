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
});
