import { expect, test } from "bun:test";
import {
	composeQueuedTelegramAck,
	shouldSendQueuedAck,
} from "../src/telegram-ack";

test("does not queue-ack short messages unless backlog is present", () => {
	expect(
		shouldSendQueuedAck({
			content: "Short ask",
			hasFileAttachment: false,
			backlogCount: 0,
		}),
	).toBe(false);
	expect(
		shouldSendQueuedAck({
			content: "Short ask",
			hasFileAttachment: false,
			backlogCount: 1,
		}),
	).toBe(true);
});

test("queue-acks long messages and file messages", () => {
	expect(
		shouldSendQueuedAck({
			content: "x".repeat(240),
			hasFileAttachment: false,
			backlogCount: 0,
		}),
	).toBe(true);
	expect(
		shouldSendQueuedAck({
			content: "Short but attached",
			hasFileAttachment: true,
			backlogCount: 0,
		}),
	).toBe(true);
});

test("uses generated ack text when the model output is usable", async () => {
	const ack = await composeQueuedTelegramAck(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			backlogCount: 0,
		},
		{
			generate: async () => "I'm on it. I'll take a look now.",
		},
	);

	expect(ack).toBe("I'm on it. I'll take a look now.");
});

test("falls back when the generated ack is unusable or throws", async () => {
	const fallback = await composeQueuedTelegramAck(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			backlogCount: 0,
		},
		{
			generate: async () => "Queued and waiting for the queue to clear.",
		},
	);
	expect(fallback).toBe("I'm on it. I'll reply when it's ready.");

	const fallbackOnError = await composeQueuedTelegramAck(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			backlogCount: 0,
		},
		{
			generate: async () => {
				throw new Error("boom");
			},
		},
	);
	expect(fallbackOnError).toBe("I'm on it. I'll reply when it's ready.");
});
