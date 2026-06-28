import { expect, test } from "bun:test";
import {
	classifyTelegramReceiptIntake,
	composeTelegramReceipt,
} from "../src/telegram-receipt";

test("returns a contextual receipt in the generated language", async () => {
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
			generateIntake: async () =>
				JSON.stringify({
					language: "pt",
					messageKind: "new_run",
					attachmentKind: "document",
					understoodGoal: "Você quer uma revisão do PDF com os pontos principais.",
					nextStep: "Vou ler a estrutura do arquivo primeiro e depois resumir.",
					reply: "Recebi o PDF. Vou ler a estrutura primeiro e depois te resumo os pontos principais.",
					missingInfo: null,
				}),
		},
	);

	expect(result.usedFallback).toBe(false);
	expect(result.intake.language).toBe("pt");
	expect(result.intake.messageKind).toBe("new_run");
	expect(result.text).toContain("Recebi o PDF");
});

test("falls back to the generic ack pool when intake fails", async () => {
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
			generateIntake: async () => {
				throw new Error("boom");
			},
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

test("classifies status checks and new runs when idle", () => {
	const statusCheck = classifyTelegramReceiptIntake({
		content: "Still there?",
		hasFileAttachment: false,
		isBusy: false,
		attachmentKind: "none",
		preferredLanguage: "en",
		activeRun: null,
	});
	expect(statusCheck.messageKind).toBe("status_check");

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
