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

test("fallback treats brief follow-ups as status checks when work is active", async () => {
	const result = await composeTelegramReceipt(
		{
			content: "Tudo bem por aí?",
			hasFileAttachment: false,
			backlogCount: 1,
			attachmentKind: "none",
			preferredLanguage: "pt",
			activeTask: {
				status: "running",
				preview: "Generate a mobile PNG from the invitation HTML",
			},
		},
		{
			generateIntake: async () => {
				throw new Error("timeout");
			},
			fallbackAck: async () => "Estou olhando isso agora.",
		},
	);

	expect(result.usedFallback).toBe(true);
	expect(result.intake.messageKind).toBe("status_check");
	expect(result.shouldEnqueue).toBe(false);
	expect(result.taskInput).toBeNull();
	expect(result.text).toBe("Estou olhando isso agora.");
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

	expect(shouldEnqueueReceiptIntake(intake, null)).toBe(false);
	expect(buildTaskInputFromReceipt("Did you read it?", intake, null)).toBeNull();
});

test("task updates stay attached to the current active thread", () => {
	const intake: TelegramReceiptIntake = {
		language: "en",
		messageKind: "task_update",
		attachmentKind: "none",
		understoodGoal: "You want to update the current task with file B.",
		nextStep: "I’ll apply that update to the current task.",
		reply: "I saw your update about file B. I’m applying it to the current task.",
		missingInfo: null,
	};

	expect(shouldEnqueueReceiptIntake(intake, {
		status: "running",
		preview: "Draft the report from file A",
	})).toBe(false);

	const taskInput = buildTaskInputFromReceipt("Actually use file B instead.", intake, {
		status: "running",
		preview: "Draft the report from file A",
	});

	expect(taskInput).toContain("This is a follow-up update to the current task.");
	expect(taskInput).toContain("Current task summary: Draft the report from file A");
	expect(taskInput).toContain("Actually use file B instead.");
});

test("blocked answers build a resume prompt for the current task", () => {
	const intake: TelegramReceiptIntake = {
		language: "en",
		messageKind: "blocked_answer",
		attachmentKind: "none",
		understoodGoal: "You want to answer the blocked question.",
		nextStep: "I’ll resume the blocked task with your answer.",
		reply: "Thanks, I’m resuming the task now.",
		missingInfo: null,
	};

	expect(
		shouldEnqueueReceiptIntake(intake, {
			status: "blocked",
			preview: "Draft the report from file A",
			question: "Should I use file B instead?",
		}),
	).toBe(false);

	const taskInput = buildTaskInputFromReceipt("Use file B instead.", intake, {
		status: "blocked",
		preview: "Draft the report from file A",
		question: "Should I use file B instead?",
	});

	expect(taskInput).toContain("The user is replying to a blocked task.");
	expect(taskInput).toContain("Blocked question: Should I use file B instead?");
	expect(taskInput).toContain("Resume the current task using this answer:");
	expect(taskInput).toContain("Use file B instead.");
});

test("clearly separate requests still enqueue while work is active", () => {
	const intake: TelegramReceiptIntake = {
		language: "en",
		messageKind: "new_task",
		attachmentKind: "none",
		understoodGoal: "You want a separate new task.",
		nextStep: "I’ll start it as a separate thread.",
		reply: "Got it. I’ll handle that as a new task.",
		missingInfo: null,
	};

	expect(
		shouldEnqueueReceiptIntake(intake, {
			status: "running",
			preview: "Draft the report from file A",
		}),
	).toBe(true);
	expect(
		buildTaskInputFromReceipt("Start a different analysis.", intake, {
			status: "running",
			preview: "Draft the report from file A",
		}),
	).toBe("Start a different analysis.");
});
