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

test("formats headings and bullet lists for Telegram HTML", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	let sentMessage: { chat_id: number; text: string; parse_mode?: string } | null =
		null;

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			sentMessage = JSON.parse(String(init?.body)) as {
				chat_id: number;
				text: string;
				parse_mode?: string;
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
		if (!sentMessage) {
			throw new Error("Expected a Telegram payload");
		}
		const payload = sentMessage as {
			chat_id: number;
			text: string;
			parse_mode?: string;
		};
		expect(payload.parse_mode).toBe("HTML");
		expect(payload.text).toContain("<b>Summary</b>");
		expect(payload.text).toContain("• first item");
		expect(payload.text).toContain("• second item");
		expect(payload.text).toContain("<code>file.txt</code>");
		expect(payload.text).toContain(
			'<a href="https://example.com">docs</a>',
		);
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

test("renders markdown tables as aligned preformatted blocks", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	let sentMessage: { chat_id: number; text: string; parse_mode?: string } | null =
		null;

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			sentMessage = JSON.parse(String(init?.body)) as {
				chat_id: number;
				text: string;
				parse_mode?: string;
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
			"| Name | Score |\n| --- | --- |\n| Alice | 10 |\n| Bob | 3 |",
		);

		expect(result.messageDelivered).toBe(true);
		if (!sentMessage) {
			throw new Error("Expected a Telegram payload");
		}
		const payload = sentMessage as {
			chat_id: number;
			text: string;
			parse_mode?: string;
		};
		expect(payload.parse_mode).toBe("HTML");
		expect(payload.text).toContain(
			"<pre>| Name  | Score |\n| ----- | ----- |\n| Alice | 10    |\n| Bob   | 3     |\n</pre>",
		);
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

test("renders collapsed inline tables as preformatted blocks", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	let sentMessage: { chat_id: number; text: string; parse_mode?: string } | null =
		null;

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			sentMessage = JSON.parse(String(init?.body)) as {
				chat_id: number;
				text: string;
				parse_mode?: string;
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
			"Done. All four triggers live now: | Trigger | When | Purpose | |---------|------|---------| | Daily Coaching Brief | 10:00 | Push day plan, tasks to Todoist | | Evening Accountability | 20:00 | Mirror — did you do what you said? | | Mid-week Review | Wed 19:00 | Adjust the plan mid-flight | | Weekly Review | Sun 12:00 | Full review, stats, next week's priorities | I'm taking this seriously, Captain. No cheerleading — coaching. If you drift, I'll call it. If you crush it, I'll say so. 🫡🤎",
		);

		expect(result.messageDelivered).toBe(true);
		if (!sentMessage) {
			throw new Error("Expected a Telegram payload");
		}
		const payload = sentMessage as {
			chat_id: number;
			text: string;
			parse_mode?: string;
		};
		expect(payload.parse_mode).toBe("HTML");
		expect(payload.text).toContain("Done. All four triggers live now:");
		expect(payload.text).toContain("<pre>| Trigger");
		expect(payload.text).toContain("| Weekly Review");
		expect(payload.text).toContain("I'm taking this seriously, Captain.");
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

test("escapes model output while preserving Telegram HTML entities", async () => {
	const previousToken = process.env.TELEGRAM_BOT_TOKEN;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	const originalFetch = globalThis.fetch;
	let sentMessage: { chat_id: number; text: string; parse_mode?: string } | null =
		null;

	process.env.TELEGRAM_BOT_TOKEN = "bot-token";
	process.env.ADMIN_TELEGRAM_ID = "123";

	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (url.includes("/sendMessage")) {
			sentMessage = JSON.parse(String(init?.body)) as {
				chat_id: number;
				text: string;
				parse_mode?: string;
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
			"**Deploy <now>**\n\n```bash\necho \"a < b && c > d\"\n```\n\nUse [docs](https://example.com?q=a&b=\"c\").",
		);

		expect(result.messageDelivered).toBe(true);
		if (!sentMessage) {
			throw new Error("Expected a Telegram payload");
		}
		const payload = sentMessage as {
			chat_id: number;
			text: string;
			parse_mode?: string;
		};
		expect(payload.parse_mode).toBe("HTML");
		expect(payload.text).toContain("<b>Deploy &lt;now&gt;</b>");
		expect(payload.text).toContain(
			'<pre>echo "a &lt; b &amp;&amp; c &gt; d"\n</pre>',
		);
		expect(payload.text).toContain(
			'<a href="https://example.com?q=a&amp;b=&quot;c&quot;">docs</a>',
		);
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
