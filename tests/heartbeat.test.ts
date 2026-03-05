import { afterEach, beforeEach, expect, test } from "bun:test";

const TEST_TASKS_FILE = "/tmp/test-scheduled.md";

const SAMPLE_TASKS = `# Scheduled Tasks

## Format
Some format info here.

---

## Active Tasks

Add tasks below.

## Simple Task
Every: 1 day at 09:00
Action: Send a daily greeting

## Multi-line Action Task
Every: 2 hours
Action: Check if you should reach out.

Evaluate these conditions:
1. Has the user been silent for 18-72 hours?
2. Is it within their awake window?
3. Have you already reached out today?

If ALL conditions are met, send a message.

## One-time Task
RunAt: 2026-03-01T12:00:00Z
Action: Remind about the meeting

## Task with LastRun
Every: 30 minutes
LastRun: 2026-02-20T10:00:00Z
Action: Quick health check
`;

function parseTasks(content: string): Array<{
	name: string;
	action: string;
	every?: string;
	runAt?: string;
	lastRun?: string;
}> {
	const tasks: Array<{
		name: string;
		action: string;
		every?: string;
		runAt?: string;
		lastRun?: string;
	}> = [];

	const activeSectionMatch = content.match(/##\s*Active Tasks\n([\s\S]*)/);
	if (!activeSectionMatch || !activeSectionMatch[1]) {
		return tasks;
	}

	const activeSection = activeSectionMatch[1];

	const parts = activeSection.split(/\n## /);

	for (const part of parts) {
		const lines = part.split("\n");
		const name = lines[0]?.trim();
		const body = lines.slice(1).join("\n").trim();

		if (!name || (!body.includes("Action:") && !body.includes("Every:") && !body.includes("RunAt:"))) {
			continue;
		}

		const task: { name: string; action: string; every?: string; runAt?: string; lastRun?: string } = { name, action: "" };

		const fieldRegex = /(?:^|\n)(Every|RunAt|LastRun|Action):\s*([\s\S]*?)(?=\n(?:Every|RunAt|LastRun|Action):|$)/g;
		const fieldMatches = Array.from(body.matchAll(fieldRegex));

		for (const fieldMatch of fieldMatches) {
			const key = fieldMatch[1]?.toLowerCase();
			const value = (fieldMatch[2] ?? "").trim();

			switch (key) {
				case "action":
					task.action = value;
					break;
				case "every":
					task.every = value;
					break;
				case "runat":
					task.runAt = value;
					break;
				case "lastrun":
					task.lastRun = value;
					break;
			}
		}

		if (task.action) {
			tasks.push(task);
		}
	}

	return tasks;
}

beforeEach(async () => {
	await Bun.write(TEST_TASKS_FILE, SAMPLE_TASKS);
});

afterEach(async () => {
	try {
		await Bun.$`rm -f ${TEST_TASKS_FILE}`;
	} catch {
		// Ignore
	}
});

test("parses simple single-line action", () => {
	const tasks = parseTasks(SAMPLE_TASKS);
	const simpleTask = tasks.find((t) => t.name === "Simple Task");

	expect(simpleTask).toBeDefined();
	expect(simpleTask?.action).toBe("Send a daily greeting");
	expect(simpleTask?.every).toBe("1 day at 09:00");
});

test("parses multi-line action with multiple paragraphs", () => {
	const tasks = parseTasks(SAMPLE_TASKS);
	const multiLineTask = tasks.find((t) => t.name === "Multi-line Action Task");

	expect(multiLineTask).toBeDefined();
	expect(multiLineTask?.action).toContain("Check if you should reach out.");
	expect(multiLineTask?.action).toContain("Evaluate these conditions:");
	expect(multiLineTask?.action).toContain("1. Has the user been silent for 18-72 hours?");
	expect(multiLineTask?.action).toContain("2. Is it within their awake window?");
	expect(multiLineTask?.action).toContain("3. Have you already reached out today?");
	expect(multiLineTask?.action).toContain("If ALL conditions are met, send a message.");
	expect(multiLineTask?.every).toBe("2 hours");
});

test("parses one-time task with RunAt", () => {
	const tasks = parseTasks(SAMPLE_TASKS);
	const oneTimeTask = tasks.find((t) => t.name === "One-time Task");

	expect(oneTimeTask).toBeDefined();
	expect(oneTimeTask?.runAt).toBe("2026-03-01T12:00:00Z");
	expect(oneTimeTask?.action).toBe("Remind about the meeting");
	expect(oneTimeTask?.every).toBeUndefined();
});

test("parses LastRun field", () => {
	const tasks = parseTasks(SAMPLE_TASKS);
	const taskWithLastRun = tasks.find((t) => t.name === "Task with LastRun");

	expect(taskWithLastRun).toBeDefined();
	expect(taskWithLastRun?.lastRun).toBe("2026-02-20T10:00:00Z");
	expect(taskWithLastRun?.every).toBe("30 minutes");
	expect(taskWithLastRun?.action).toBe("Quick health check");
});

test("returns empty array when no Active Tasks section", () => {
	const content = `# Scheduled Tasks\n\n## Some Other Section\n\n## Task\nAction: Test`;
	const tasks = parseTasks(content);
	expect(tasks).toHaveLength(0);
});

test("returns empty array for empty Active Tasks section", () => {
	const content = `## Active Tasks\n\n`;
	const tasks = parseTasks(content);
	expect(tasks).toHaveLength(0);
});

test("handles task without action field", () => {
	const content = `## Active Tasks\n\n## Incomplete Task\nEvery: 1 day\n`;
	const tasks = parseTasks(content);
	expect(tasks).toHaveLength(0);
});

test("parses all tasks from sample file", async () => {
	const content = await Bun.file(TEST_TASKS_FILE).text();
	const tasks = parseTasks(content);

	expect(tasks).toHaveLength(4);
	expect(tasks.map((t) => t.name)).toContain("Simple Task");
	expect(tasks.map((t) => t.name)).toContain("Multi-line Action Task");
	expect(tasks.map((t) => t.name)).toContain("One-time Task");
	expect(tasks.map((t) => t.name)).toContain("Task with LastRun");
});

test("multi-line action preserves line breaks", () => {
	const tasks = parseTasks(SAMPLE_TASKS);
	const multiLineTask = tasks.find((t) => t.name === "Multi-line Action Task");

	const lines = multiLineTask?.action.split("\n") ?? [];
	expect(lines.length).toBeGreaterThan(3);
	expect(lines[0]).toBe("Check if you should reach out.");
	expect(lines[1]).toBe("");
	expect(lines[2]).toBe("Evaluate these conditions:");
});

test("handles action with special characters", () => {
	const content = `## Active Tasks

## Special Task
Action: Send "hello" with $10 and \`code\`
`;
	const tasks = parseTasks(content);

	expect(tasks).toHaveLength(1);
	expect(tasks[0]?.action).toBe('Send "hello" with $10 and `code`');
});

test("handles action with colons in text", () => {
	const content = `## Active Tasks

## Colon Task
Action: Send message: "Hello: World"
`;
	const tasks = parseTasks(content);

	expect(tasks).toHaveLength(1);
	expect(tasks[0]?.action).toBe('Send message: "Hello: World"');
});
