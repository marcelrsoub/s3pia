import { afterEach, expect, test } from "bun:test";

import { syncDefaultWorkspaceFiles } from "../src/workspace-sync";

const TEMPLATE_ROOT = "/tmp/s3pia-template-root";
const WORKSPACE_ROOT = "/tmp/s3pia-workspace-root";

async function cleanup(): Promise<void> {
	try {
		await Bun.$`rm -rf ${TEMPLATE_ROOT} ${WORKSPACE_ROOT}`;
	} catch {
		// Ignore cleanup errors
	}
}

afterEach(async () => {
	await cleanup();
});

test("copies missing default skills into an existing workspace", async () => {
	await Bun.write(`${TEMPLATE_ROOT}/skills/public_pages.md`, "# Public Pages\n");
	await Bun.write(`${WORKSPACE_ROOT}/skills/existing.md`, "# Existing\n");

	const result = await syncDefaultWorkspaceFiles(WORKSPACE_ROOT, TEMPLATE_ROOT);

	expect(result.copiedFiles).toContain("skills/public_pages.md");
	expect(await Bun.file(`${WORKSPACE_ROOT}/skills/public_pages.md`).text()).toBe(
		"# Public Pages\n",
	);
	expect(await Bun.file(`${WORKSPACE_ROOT}/skills/existing.md`).text()).toBe(
		"# Existing\n",
	);
});

test("does not overwrite an existing skill file", async () => {
	await Bun.write(`${TEMPLATE_ROOT}/skills/public_pages.md`, "# New Template\n");
	await Bun.write(`${WORKSPACE_ROOT}/skills/public_pages.md`, "# User Version\n");

	const result = await syncDefaultWorkspaceFiles(WORKSPACE_ROOT, TEMPLATE_ROOT);

	expect(result.copiedFiles).not.toContain("skills/public_pages.md");
	expect(await Bun.file(`${WORKSPACE_ROOT}/skills/public_pages.md`).text()).toBe(
		"# User Version\n",
	);
});
