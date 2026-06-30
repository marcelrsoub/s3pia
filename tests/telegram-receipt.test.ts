import { expect, test } from "bun:test";
import { classifyTelegramReceiptIntake } from "../src/telegram-receipt";

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
