import { expect, test } from "bun:test";
import { dirname, resolve, sep } from "node:path";

import {
	syncDefaultWorkspaceFiles,
	type WorkspaceSyncEnvironment,
} from "../src/workspace-sync";

const TEMPLATE_ROOT = "/template";
const WORKSPACE_ROOT = "/workspace";

function createMemoryWorkspaceSyncEnvironment(
	initialFiles: Record<string, string> = {},
): {
	env: WorkspaceSyncEnvironment;
	files: Map<string, string>;
} {
	const files = new Map<string, string>();
	const dirs = new Set<string>();

	const normalize = (path: string): string => resolve(path);

	const ensureDir = (path: string): void => {
		let current = normalize(path);
		while (!dirs.has(current)) {
			dirs.add(current);
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	};

	const addFile = (path: string, content: string): void => {
		const normalized = normalize(path);
		files.set(normalized, content);
		ensureDir(dirname(normalized));
	};

	for (const [path, content] of Object.entries(initialFiles)) {
		addFile(path, content);
	}

	const env: WorkspaceSyncEnvironment = {
		existsSync: (path) => {
			const normalized = normalize(path);
			return files.has(normalized) || dirs.has(normalized);
		},
		mkdirSync: (path, options) => {
			if (options?.recursive) {
				ensureDir(path);
				return;
			}
			dirs.add(normalize(path));
		},
		readdirSync: (path) => {
			const normalized = normalize(path);
			if (!files.has(normalized) && !dirs.has(normalized)) {
				throw new Error(`Missing directory: ${normalized}`);
			}

			const prefix = normalized.endsWith(sep)
				? normalized
				: `${normalized}${sep}`;
			const entries = new Set<string>();
			for (const candidate of [...files.keys(), ...dirs.keys()]) {
				if (!candidate.startsWith(prefix) || candidate === normalized) {
					continue;
				}
				const relative = candidate.slice(prefix.length);
				const entry = relative.split(sep)[0];
				if (entry) entries.add(entry);
			}

			return [...entries];
		},
		readTextFile: async (path) => {
			const normalized = normalize(path);
			const content = files.get(normalized);
			if (content === undefined) {
				throw new Error(`Missing file: ${normalized}`);
			}
			return content;
		},
		writeTextFile: async (path, content) => {
			addFile(path, content);
		},
	};

	return { env, files };
}

test("copies missing default skills into an existing workspace", async () => {
	const templateSkill = `${TEMPLATE_ROOT}/skills/public_pages.md`;
	const workspaceExistingSkill = `${WORKSPACE_ROOT}/skills/existing.md`;
	const workspaceSkill = `${WORKSPACE_ROOT}/skills/public_pages.md`;

	const { env, files } = createMemoryWorkspaceSyncEnvironment({
		[templateSkill]: "# Public Pages\n",
		[workspaceExistingSkill]: "# Existing\n",
	});

	const result = await syncDefaultWorkspaceFiles(
		WORKSPACE_ROOT,
		TEMPLATE_ROOT,
		env,
	);

	expect(result.copiedFiles).toContain("skills/public_pages.md");
	expect(files.get(resolve(workspaceSkill))).toBe("# Public Pages\n");
	expect(files.get(resolve(workspaceExistingSkill))).toBe("# Existing\n");
});

test("copies workspace docs but never seeds architecture policy into the workspace", async () => {
	const templateBootstrap = `${TEMPLATE_ROOT}/BOOTSTRAP.md`;
	const templateArchitecture = `${TEMPLATE_ROOT}/ARCHITECTURE.md`;
	const workspaceBootstrap = `${WORKSPACE_ROOT}/BOOTSTRAP.md`;
	const workspaceArchitecture = `${WORKSPACE_ROOT}/ARCHITECTURE.md`;

	const { env, files } = createMemoryWorkspaceSyncEnvironment({
		[templateBootstrap]: "# Bootstrap\n",
		[templateArchitecture]: "# Architecture\n",
	});

	const result = await syncDefaultWorkspaceFiles(
		WORKSPACE_ROOT,
		TEMPLATE_ROOT,
		env,
	);

	expect(result.copiedFiles).toContain("BOOTSTRAP.md");
	expect(result.copiedFiles).not.toContain("ARCHITECTURE.md");
	expect(files.get(resolve(workspaceBootstrap))).toBe("# Bootstrap\n");
	expect(files.has(resolve(workspaceArchitecture))).toBe(false);
});

test("does not overwrite an existing skill file", async () => {
	const templateSkill = `${TEMPLATE_ROOT}/skills/public_pages.md`;
	const workspaceSkill = `${WORKSPACE_ROOT}/skills/public_pages.md`;

	const { env, files } = createMemoryWorkspaceSyncEnvironment({
		[templateSkill]: "# New Template\n",
		[workspaceSkill]: "# User Version\n",
	});

	const result = await syncDefaultWorkspaceFiles(
		WORKSPACE_ROOT,
		TEMPLATE_ROOT,
		env,
	);

	expect(result.copiedFiles).not.toContain("skills/public_pages.md");
	expect(files.get(resolve(workspaceSkill))).toBe("# User Version\n");
});
