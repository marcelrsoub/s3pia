import { expect, test } from "bun:test";
import {
	classifyTelegramReceiptIntake,
	composeTelegramReceipt,
} from "../src/telegram-receipt";

test("returns a deterministic fallback receipt", async () => {
	const result = await composeTelegramReceipt(
		{
			content: "Preciso que você revise este PDF e me diga os pontos principais.",
			hasFileAttachment: true,
			isBusy: false,
			attachmentKind: "document",
			preferredLanguage: null,
			activeRun: null,
		},
		{
			fallbackAck: async () => "I'm on it. I'll take a look now.",
		},
	);

	expect(result.usedFallback).toBe(true);
	expect(result.intake.language).toBe("pt");
	expect(result.intake.messageKind).toBe("new_run");
	expect(result.text).toBe("I'm on it. I'll take a look now.");
});

test("uses the generic ack pool for active run receipts", async () => {
	const result = await composeTelegramReceipt(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			isBusy: true,
			attachmentKind: "none",
			preferredLanguage: null,
			activeRun: {
				status: "running",
				preview: "Generate a mobile PNG from the invitation HTML",
			},
		},
		{
			fallbackAck: async () => "I'm on it. I'll take a look now.",
		},
	);

	expect(result.usedFallback).toBe(true);
	expect(result.text).toBe("I'm on it. I'll take a look now.");
	expect(result.intake.messageKind).toBe("live_update");
});

test("classifies live updates and blocked answers from the live thread", () => {
	const liveUpdate = classifyTelegramReceiptIntake({
		content: "Actually use file B instead.",
		hasFileAttachment: false,
		isBusy: true,
		attachmentKind: "none",
		preferredLanguage: "en",
		activeRun: {
			status: "running",
			preview: "Draft the report from file A",
		},
	});
	expect(liveUpdate.messageKind).toBe("live_update");
	expect(liveUpdate.nextStep).toContain("current run");

	const blockedAnswer = classifyTelegramReceiptIntake({
		content: "Use file B instead.",
		hasFileAttachment: false,
		isBusy: true,
		attachmentKind: "none",
		preferredLanguage: "en",
		activeRun: {
			status: "blocked",
			preview: "Draft the report from file A",
			question: "Should I use file B instead?",
		},
	});
	expect(blockedAnswer.messageKind).toBe("blocked_answer");
	expect(blockedAnswer.understoodGoal).toContain("answer");
});

test("classifies idle messages as new runs", () => {
	const idleMessage = classifyTelegramReceiptIntake({
		content: "Still there?",
		hasFileAttachment: false,
		isBusy: false,
		attachmentKind: "none",
		preferredLanguage: "en",
		activeRun: null,
	});
	expect(idleMessage.messageKind).toBe("new_run");

	const newRun = classifyTelegramReceiptIntake({
		content: "Please draft a summary of these notes.",
		hasFileAttachment: false,
		isBusy: false,
		attachmentKind: "none",
		preferredLanguage: "en",
		activeRun: null,
	});
	expect(newRun.messageKind).toBe("new_run");
});
