import { expect, test } from "bun:test";
import { loadWorkspaceContext } from "../src/prompts";

test("includes a Docker runtime guardrail in the workspace context", async () => {
	const context = await loadWorkspaceContext();

	expect(context).toContain("Telegram is the only user-facing channel.");
	expect(context).toContain("You are running inside Docker.");
	expect(context).toContain(
		"cannot publish new host ports from inside the task",
	);
});
