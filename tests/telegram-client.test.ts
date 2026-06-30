import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
	normalizeWorkspaceFilePath,
	sendTelegramMessageToAdmin,
} from "../src/telegram-client";
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

test("treats a sent text as delivered even if an attachment upload fails", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	const tempDir = workspacePath("tmp");
	const tempFile = workspacePath(
		"tmp",
		`telegram-client-test-${crypto.randomUUID()}.txt`,
	);

	await Bun.$`mkdir -p ${tempDir}`;
	await Bun.write(tempFile, "attachment content");

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (url.includes("/sendDocument")) {
			return new Response(
				JSON.stringify({ ok: false, description: "upload failed" }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}
		throw new Error(`Unexpected fetch: ${url}`);
	}) as typeof fetch;

	try {
		const result = await sendTelegramMessageToAdmin(
			"Hello from the test",
			[tempFile],
		);

		expect(result.messageDelivered).toBe(true);
		expect(result.ok).toBe(false);
		expect(result.warnings).toContain(`Failed to send file: ${tempFile}`);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousToken === undefined) {
			delete process.env.TELEGRAM_BOT_TOKEN;
		} else {
			process.env.TELEGRAM_BOT_TOKEN = previousToken;
		}
		if (previousAdminId === undefined) {
			delete process.env.ADMIN_TELEGRAM_ID;
		} else {
			process.env.ADMIN_TELEGRAM_ID = previousAdminId;
		}
		try {
			await Bun.$`rm -f ${tempFile}`;
		} catch {
			// Ignore cleanup failures.
		}
	}
});

test("formats markdown into Telegram entities", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	let sentMessage:
		| {
				chat_id: number;
				text: string;
				entities?: Array<{
					type: string;
					offset: number;
					length: number;
					url?: string;
				}>;
		  }
		| null = null;

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			sentMessage = JSON.parse(String(init?.body)) as {
				chat_id: number;
				text: string;
				entities?: Array<{
					type: string;
					offset: number;
					length: number;
					url?: string;
				}>;
			};
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		throw new Error(`Unexpected fetch: ${url}`);
	}) as typeof fetch;

	try {
		const result = await sendTelegramMessageToAdmin(
			"# Summary\n\n- first item\n- second item\n\nUse `file.txt` and [docs](https://example.com).",
		);

		expect(result.messageDelivered).toBe(true);
		const payload = sentMessage;
		if (!payload) {
			throw new Error("Expected a Telegram payload");
		}
		expect(payload.text).toBe(
			"Summary\n\n- first item\n- second item\n\nUse file.txt and docs.",
		);
		expect(payload.entities).toEqual([
			{ type: "bold", offset: 0, length: 7 },
			{ type: "code", offset: 41, length: 8 },
			{
				type: "text_link",
				offset: 54,
				length: 4,
				url: "https://example.com",
			},
		]);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousToken === undefined) {
			delete process.env.TELEGRAM_BOT_TOKEN;
		} else {
			process.env.TELEGRAM_BOT_TOKEN = previousToken;
		}
		if (previousAdminId === undefined) {
			delete process.env.ADMIN_TELEGRAM_ID;
		} else {
			process.env.ADMIN_TELEGRAM_ID = previousAdminId;
		}
	}
});

test("splits long messages into plain text chunks", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	const sentMessages: Array<{
		chat_id: number;
		text: string;
		entities?: Array<{
			type: string;
			offset: number;
			length: number;
			url?: string;
		}>;
	}> = [];

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			sentMessages.push(
				JSON.parse(String(init?.body)) as {
					chat_id: number;
					text: string;
					entities?: Array<{
						type: string;
						offset: number;
						length: number;
						url?: string;
					}>;
				},
			);
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		throw new Error(`Unexpected fetch: ${url}`);
	}) as typeof fetch;

	try {
		const result = await sendTelegramMessageToAdmin("a".repeat(3701));

		expect(result.messageDelivered).toBe(true);
		expect(sentMessages).toHaveLength(2);
		expect(sentMessages[0]?.entities).toBeUndefined();
		expect(sentMessages[1]?.entities).toBeUndefined();
		expect(sentMessages[0]?.text.length).toBe(3600);
		expect(sentMessages[1]?.text.length).toBe(101);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousToken === undefined) {
			delete process.env.TELEGRAM_BOT_TOKEN;
		} else {
			process.env.TELEGRAM_BOT_TOKEN = previousToken;
		}
		if (previousAdminId === undefined) {
			delete process.env.ADMIN_TELEGRAM_ID;
		} else {
			process.env.ADMIN_TELEGRAM_ID = previousAdminId;
		}
	}
});
