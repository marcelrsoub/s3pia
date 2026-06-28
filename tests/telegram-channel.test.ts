import { expect, test } from "bun:test";
import { conversationStore, TELEGRAM_CONVERSATION_ID } from "../src/conversation";
import { TelegramChannel } from "../src/channels/telegram";

test("steer command forwards a live nudge to the current run", async () => {
	const globalScope = globalThis as Record<string, unknown>;
	const requests: Array<{
		conversationId?: string;
		source: string;
		kind: string;
		preview?: string;
	}> = [];
	const previousCoordinator = globalScope.__s3piaLiveRunCoordinator;

	globalScope.__s3piaLiveRunCoordinator =
		{
			requestRun(request: {
				conversationId?: string;
				source: string;
				kind: string;
				preview?: string;
			}) {
				requests.push(request);
			},
			cancelActiveRun() {
				return null;
			},
			getStatusSnapshot() {
				return {
					conversationId: "telegram",
					status: "running",
					currentRun: null,
					canCancel: true,
					rerunRequested: false,
				};
			},
		};

	try {
		const channel = new TelegramChannel({
			enabled: true,
			allowFrom: ["1"],
			token: "test-token",
		});
		const channelAny = channel as unknown as {
			handleCommand(chatId: number, text: string): Promise<void>;
			sendRawMessage(chatId: number, text: string): Promise<boolean>;
		};

		const replies: string[] = [];
		channelAny.sendRawMessage = async (_chatId: number, text: string) => {
			replies.push(text);
			return true;
		};

		await channelAny.handleCommand(
			123,
			"/steer focus on the error handling in section 2",
		);

		expect(requests).toEqual([
			{
				conversationId: "telegram",
				source: "manual",
				kind: "steer",
				preview: "focus on the error handling in section 2",
			},
		]);
		expect(replies[0]).toContain("Steering the current live run");
	} finally {
		globalScope.__s3piaLiveRunCoordinator = previousCoordinator;
	}
});

test("routes an idle chat message into a live run instead of stopping at status", async () => {
	const globalScope = globalThis as Record<string, unknown>;
	const requests: Array<{
		conversationId?: string;
		source: string;
		kind: string;
		preview?: string;
	}> = [];
	const previousCoordinator = globalScope.__s3piaLiveRunCoordinator;
	const previousAdminId = process.env.ADMIN_TELEGRAM_ID;
	process.env.ADMIN_TELEGRAM_ID = "1";

	globalScope.__s3piaLiveRunCoordinator =
		{
			requestRun(request: {
				conversationId?: string;
				source: string;
				kind: string;
				preview?: string;
			}) {
				requests.push(request);
			},
			cancelActiveRun() {
				return null;
			},
			getStatusSnapshot() {
				return {
					conversationId: "telegram",
					status: "idle",
					currentRun: null,
					canCancel: false,
					rerunRequested: false,
				};
			},
		};

	try {
		const channel = new TelegramChannel({
			enabled: true,
			allowFrom: ["1"],
			token: "test-token",
		});
		const channelAny = channel as unknown as {
			processUpdate(update: {
				update_id: number;
				message?: {
					message_id: number;
					chat: { id: number; type: string };
					from?: { id: number; first_name?: string; username?: string };
					text?: string;
					caption?: string;
				};
			}): Promise<void>;
			sendRawMessage(chatId: number, text: string): Promise<boolean>;
		};

		const replies: string[] = [];
		channelAny.sendRawMessage = async (_chatId: number, text: string) => {
			replies.push(text);
			return true;
		};

		await channelAny.processUpdate({
			update_id: 1,
			message: {
				message_id: 1,
				chat: { id: 123, type: "private" },
				from: { id: 1, first_name: "Marcel" },
				text: "what's up",
			},
		});

		expect(requests).toEqual([
			{
				conversationId: "telegram",
				source: "telegram",
				kind: "new_run",
				preview: "what's up",
			},
		]);
		expect(replies).toHaveLength(0);
	} finally {
		globalScope.__s3piaLiveRunCoordinator = previousCoordinator;
		if (previousAdminId === undefined) {
			delete process.env.ADMIN_TELEGRAM_ID;
		} else {
			process.env.ADMIN_TELEGRAM_ID = previousAdminId;
		}
	}
});

test("restores the last processed Telegram update id from persisted metadata", async () => {
	const previousMetadata = conversationStore.getMetadata(
		TELEGRAM_CONVERSATION_ID,
	).telegramLastProcessedUpdateId;
	conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
		telegramLastProcessedUpdateId: 41,
	});

	const originalFetch = globalThis.fetch;
	const requestedUrls: string[] = [];
	globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
		requestedUrls.push(String(input));
		return new Response(
			JSON.stringify({
				ok: true,
				result: [],
			}),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json",
				},
			},
		);
	}) as typeof fetch;

	try {
		const channel = new TelegramChannel({
			enabled: true,
			allowFrom: ["1"],
			token: "test-token",
		});

		await channel.start();
		await channel.stop();

		expect(requestedUrls[0]).toContain("offset=42");
	} finally {
		globalThis.fetch = originalFetch;
		conversationStore.updateMetadata(TELEGRAM_CONVERSATION_ID, {
			telegramLastProcessedUpdateId: previousMetadata,
		});
	}
});
