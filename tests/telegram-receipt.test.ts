import { expect, test } from "bun:test";
import {
	buildTaskInputFromReceipt,
	composeTelegramReceipt,
	shouldEnqueueReceiptIntake,
	type TelegramReceiptIntake,
} from "../src/telegram-receipt";

test("returns a contextual receipt in the generated language", async () => {
	const result = await composeTelegramReceipt(
		{
			content: "Preciso que você revise este PDF e me diga os pontos principais.",
			hasFileAttachment: true,
			backlogCount: 0,
			attachmentKind: "document",
			preferredLanguage: null,
			activeTask: null,
		},
		{
			generateIntake: async () =>
				JSON.stringify({
					language: "pt",
					messageKind: "new_task",
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
	expect(result.text).toContain("Recebi o PDF");
	expect(result.shouldEnqueue).toBe(true);
	expect(result.taskInput).toContain("Preciso que você revise este PDF");
});

test("falls back to the generic ack pool when intake fails", async () => {
	const result = await composeTelegramReceipt(
		{
			content: "Long request text".repeat(20),
			hasFileAttachment: false,
			backlogCount: 1,
			attachmentKind: "none",
			preferredLanguage: null,
			activeTask: null,
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
	expect(result.intake.messageKind).toBe("new_task");
});

test("status checks do not enqueue follow-up work", () => {
	const intake: TelegramReceiptIntake = {
		language: "en",
		messageKind: "status_check",
		attachmentKind: "none",
		understoodGoal: "You want a status update.",
		nextStep: "I’ll tell you where the current task stands.",
		reply: "I saw your check-in. I’m still working through the current task.",
		missingInfo: null,
	};

	expect(shouldEnqueueReceiptIntake(intake)).toBe(false);
	expect(buildTaskInputFromReceipt("Did you read it?", intake, null)).toBeNull();
});

test("task updates are rewritten against the current active task", () => {
	const intake: TelegramReceiptIntake = {
		language: "en",
		messageKind: "task_update",
		attachmentKind: "none",
		understoodGoal: "You want to update the current task with file B.",
		nextStep: "I’ll apply that update to the current task.",
		reply: "I saw your update about file B. I’m applying it to the current task.",
		missingInfo: null,
	};

	const taskInput = buildTaskInputFromReceipt("Actually use file B instead.", intake, {
		status: "running",
		preview: "Draft the report from file A",
	});

	expect(taskInput).toContain("follow-up update to the current task");
	expect(taskInput).toContain("Actually use file B instead.");
	expect(taskInput).toContain("Draft the report from file A");
});
