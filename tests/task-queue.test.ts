import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { TaskQueue, type TaskStatus } from "../src/task-queue";

const temporaryDatabases: string[] = [];

function temporaryDatabase(): string {
	const path = `/tmp/s3pia-task-queue-${crypto.randomUUID()}.db`;
	temporaryDatabases.push(path);
	return path;
}

async function waitFor(
	check: () => boolean,
	timeoutMs = 2_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await Bun.sleep(10);
	}
	throw new Error("Timed out waiting for task queue");
}

afterEach(() => {
	for (const path of temporaryDatabases.splice(0)) {
		for (const suffix of ["", "-shm", "-wal"]) {
			try {
				unlinkSync(`${path}${suffix}`);
			} catch {
				// File may not have been created.
			}
		}
	}
});

test("runs queued tasks serially and suppresses duplicate source keys", async () => {
	const dbPath = temporaryDatabase();
	let active = 0;
	let maxActive = 0;
	const queue = new TaskQueue(
		dbPath,
		async (input) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await Bun.sleep(25);
			active--;
			return {
				task: input,
				result: `completed ${input}`,
				actions: [],
				iterations: 1,
				duration: 25,
			};
		},
		async () => true,
	);

	const first = queue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:1",
		input: "first",
	});
	const duplicate = queue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:1",
		input: "duplicate",
	});
	queue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:2",
		input: "second",
	});
	queue.start();

	await waitFor(
		() =>
			queue.getBySourceKey("telegram:1")?.deliveryStatus === "sent" &&
			queue.getBySourceKey("telegram:2")?.deliveryStatus === "sent",
	);

	expect(first.created).toBe(true);
	expect(duplicate.created).toBe(false);
	expect(duplicate.task.id).toBe(first.task.id);
	expect(maxActive).toBe(1);
	await queue.close();
});

test("recovers running tasks after restart", async () => {
	const dbPath = temporaryDatabase();
	const initialQueue = new TaskQueue(
		dbPath,
		async (input) => ({
			task: input,
			result: "unused",
			actions: [],
			iterations: 1,
			duration: 0,
		}),
		async () => true,
	);
	initialQueue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:restart",
		input: "recover me",
	});
	await initialQueue.close();

	const db = new Database(dbPath);
	db.run(
		"UPDATE agent_tasks SET status = 'running' WHERE source_key = 'telegram:restart'",
	);
	db.close();

	let executions = 0;
	const recoveredQueue = new TaskQueue(
		dbPath,
		async (input) => {
			executions++;
			return {
				task: input,
				result: "recovered",
				actions: [],
				iterations: 1,
				duration: 0,
			};
		},
		async () => true,
	);
	recoveredQueue.start();

	await waitFor(
		() =>
			recoveredQueue.getBySourceKey("telegram:restart")?.deliveryStatus ===
			"sent",
	);
	expect(executions).toBe(1);
	expect(recoveredQueue.getBySourceKey("telegram:restart")?.status).toBe(
		"completed" satisfies TaskStatus,
	);
	await recoveredQueue.close();
});

test("retries delivery without rerunning completed work", async () => {
	const dbPath = temporaryDatabase();
	let executions = 0;
	let deliveries = 0;
	const queue = new TaskQueue(
		dbPath,
		async (input) => {
			executions++;
			return {
				task: input,
				result: "finished",
				actions: [],
				iterations: 1,
				duration: 0,
			};
		},
		async () => {
			deliveries++;
			return deliveries > 1;
		},
	);
	queue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:delivery",
		input: "deliver once",
	});
	queue.start();

	await waitFor(
		() =>
			queue.getBySourceKey("telegram:delivery")?.deliveryStatus === "sent",
		3_000,
	);
	expect(executions).toBe(1);
	expect(deliveries).toBeGreaterThanOrEqual(2);
	await queue.close();
});

test("resumes the latest blocked task even when a newer queued task exists", async () => {
	const dbPath = temporaryDatabase();
	let executions = 0;
	const seenInputs: string[] = [];
	const queue = new TaskQueue(
		dbPath,
		async (input) => {
			executions++;
			seenInputs.push(input);
			if (executions === 1) {
				return {
					task: input,
					result: "Need the target filename.",
					question: "Which file should I edit?",
					blocked: true,
					actions: [],
					iterations: 1,
					duration: 0,
				};
			}

			return {
				task: input,
				result: "updated file-b.txt",
				actions: [],
				iterations: 1,
				duration: 0,
			};
		},
		async () => true,
	);

	const created = queue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:blocked",
		input: "Update the report",
	});
	queue.start();

	await waitFor(
		() => queue.getBySourceKey("telegram:blocked")?.status === "blocked",
	);
	queue.stop();

	queue.enqueue({
		kind: "telegram",
		sourceKey: "telegram:newer",
		input: "Handle a separate newer task",
	});

	expect(queue.getLatestActive()?.sourceKey).toBe("telegram:newer");
	expect(queue.getLatestBlocked()?.sourceKey).toBe("telegram:blocked");

	const resumed = queue.resumeBlockedTask(
		queue.getLatestBlocked()?.id || created.task.id,
		"Resume the current task using this answer:\nUse file-b.txt.",
	);
	expect(resumed?.id).toBe(created.task.id);
	expect(resumed?.status).toBe("queued" satisfies TaskStatus);
	queue.start();

	await waitFor(
		() => queue.getBySourceKey("telegram:blocked")?.status === "completed",
	);
	await waitFor(
		() => queue.getBySourceKey("telegram:newer")?.status === "completed",
	);

	expect(executions).toBe(3);
	expect(seenInputs).toEqual([
		"Update the report",
		"Resume the current task using this answer:\nUse file-b.txt.",
		"Handle a separate newer task",
	]);
	await queue.close();
});
