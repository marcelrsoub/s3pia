import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { normalizeWorkspaceFilePath } from "../src/telegram-client";
import { workspacePath } from "../src/workspace";

test("normalizes relative paths inside the workspace", () => {
	expect(normalizeWorkspaceFilePath("files/report.txt")).toBe(
		resolve(workspacePath(), "files/report.txt"),
	);
});

test("maps Docker workspace paths to the active workspace", () => {
	expect(normalizeWorkspaceFilePath("/app/ws/files/report.txt")).toBe(
		resolve(workspacePath(), "files/report.txt"),
	);
});

test("rejects paths outside the workspace", () => {
	expect(normalizeWorkspaceFilePath("../outside.txt")).toBeNull();
	expect(normalizeWorkspaceFilePath("/tmp/outside.txt")).toBeNull();
});
