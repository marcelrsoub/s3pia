import { expect, test } from "bun:test";
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
