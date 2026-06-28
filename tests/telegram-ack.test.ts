import { expect, test } from "bun:test";
import {
	composeLiveTelegramAck,
	shouldSendLiveAck,
} from "../src/telegram-ack";

test("does not send a live ack for short idle messages", () => {
	expect(
		shouldSendLiveAck({
			content: "Short ask",
			hasFileAttachment: false,
			isBusy: false,
		}),
	).toBe(false);
	expect(
		shouldSendLiveAck({
			content: "Short ask",
			hasFileAttachment: false,
			isBusy: true,
		}),
	).toBe(true);
});

test("sends live acks for long messages and file messages", () => {
	expect(
		shouldSendLiveAck({
			content: "x".repeat(240),
			hasFileAttachment: false,
			isBusy: false,
		}),
	).toBe(true);
	expect(
		shouldSendLiveAck({
			content: "Short but attached",
			hasFileAttachment: true,
			isBusy: false,
		}),
	).toBe(true);
});

test("uses generated ack text when the model output is usable", async () => {
	const ack = await composeLiveTelegramAck(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			isBusy: false,
		},
		{
			generate: async () => "I'm on it. I'll take a look now.",
		},
	);

	expect(ack).toBe("I'm on it. I'll take a look now.");
});

test("falls back to a pooled reply when the generated ack is unusable", async () => {
	const fallback = await composeLiveTelegramAck(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			isBusy: false,
		},
		{
			generate: async () => "Queued and waiting for the queue to clear.",
			fallbackMessages: [
				"I'm on it. I'll take a look now.",
				"Got it. I'm checking this now.",
			],
			random: () => 0.9,
		},
	);
	expect(fallback).toBe("Got it. I'm checking this now.");
});

test("falls back to the provided static message when asked", async () => {
	const fallbackOnError = await composeLiveTelegramAck(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			isBusy: false,
		},
		{
			generate: async () => {
				throw new Error("boom");
			},
			fallbackMessage: "I'm on it. I'll reply when it's ready.",
		},
	);
	expect(fallbackOnError).toBe("I'm on it. I'll reply when it's ready.");
});
