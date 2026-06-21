import { generateText } from "ai";
import { z } from "zod";
import { createConfiguredLanguageModel } from "./model.js";
import {
	composeQueuedTelegramAck,
	type TelegramAckContext,
} from "./telegram-ack.js";

export type TelegramMessageKind =
	| "new_task"
	| "task_update"
	| "status_check"
	| "blocked_answer";

export type TelegramAttachmentKind =
	| "none"
	| "photo"
	| "document"
	| "video"
	| "audio"
	| "voice"
	| "file";

export interface TelegramActiveTaskContext {
	status: "queued" | "running" | "blocked";
	preview: string;
	question?: string;
}

export interface TelegramReceiptContext extends TelegramAckContext {
	attachmentKind: TelegramAttachmentKind;
	preferredLanguage?: string | null;
	activeTask?: TelegramActiveTaskContext | null;
}

export interface TelegramReceiptIntake {
	language: string;
	messageKind: TelegramMessageKind;
	attachmentKind: TelegramAttachmentKind;
	understoodGoal: string;
	nextStep: string;
	reply: string;
	missingInfo?: string | null;
}

export interface TelegramReceiptResult {
	text: string;
	intake: TelegramReceiptIntake;
	usedFallback: boolean;
	shouldEnqueue: boolean;
	taskInput: string | null;
}

export interface TelegramReceiptComposerOptions {
	timeoutMs?: number;
	generateIntake?: (
		context: TelegramReceiptContext,
		signal: AbortSignal,
	) => Promise<string>;
	fallbackAck?: (context: TelegramAckContext) => Promise<string>;
}

const IntakeSchema = z.object({
	language: z.string().min(2).max(16),
	messageKind: z.enum([
		"new_task",
		"task_update",
		"status_check",
		"blocked_answer",
	]),
	attachmentKind: z.enum([
		"none",
		"photo",
		"document",
		"video",
		"audio",
		"voice",
		"file",
	]),
	understoodGoal: z.string().min(1).max(160),
	nextStep: z.string().min(1).max(160),
	reply: z.string().min(1).max(240),
	missingInfo: z.string().max(160).nullable().optional(),
});

function sanitizeReceiptText(text: string): string | null {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (!normalized) return null;
	if (normalized.length > 240) return null;
	if (normalized.includes("```")) return null;
	return normalized;
}

function inferLanguageHeuristic(
	text: string,
	preferredLanguage?: string | null,
): string {
	const sample = text.trim().toLowerCase();
	if (!sample) return preferredLanguage || "en";

	if (/[ãõçáéíóúâêô]/i.test(sample)) return "pt";
	if (/[ñ¿¡]/i.test(sample)) return "es";
	if (/[àèìòù]/i.test(sample)) return "it";
	if (/[äöüß]/i.test(sample)) return "de";
	if (/[а-яё]/i.test(sample)) return "ru";
	if (/[一-龯ぁ-んァ-ン]/i.test(sample)) return "ja";
	if (/[가-힣]/i.test(sample)) return "ko";
	if (/[ء-ي]/i.test(sample)) return "ar";

	const textForWords = ` ${sample} `;
	if (
		/\b(ol[áa]|obrigad|preciso|quero|pode|arquivo|mensagem)\b/i.test(
			textForWords,
		)
	) {
		return "pt";
	}
	if (
		/\b(hola|gracias|necesito|quiero|puedes|archivo|mensaje)\b/i.test(
			textForWords,
		)
	) {
		return "es";
	}
	if (/\b(bonjour|merci|besoin|fichier|message)\b/i.test(textForWords)) {
		return "fr";
	}
	if (/\b(hallo|danke|datei|nachricht)\b/i.test(textForWords)) {
		return "de";
	}

	return preferredLanguage || "en";
}

function buildFallbackIntake(
	context: TelegramReceiptContext,
	fallbackText: string,
): TelegramReceiptIntake {
	const activeTask = context.activeTask;
	const defaultKind: TelegramMessageKind = activeTask
		? activeTask.status === "blocked"
			? "blocked_answer"
			: "task_update"
		: "new_task";

	return {
		language: inferLanguageHeuristic(
			context.content,
			context.preferredLanguage,
		),
		messageKind: defaultKind,
		attachmentKind: context.attachmentKind,
		understoodGoal: activeTask
			? "I received your update for the current task."
			: "I received your message.",
		nextStep: activeTask
			? "I’ll apply it while the current work continues."
			: "I’ll review it and continue from there.",
		reply: fallbackText,
		missingInfo: null,
	};
}

export function shouldEnqueueReceiptIntake(
	intake: TelegramReceiptIntake,
): boolean {
	return intake.messageKind !== "status_check";
}

export function buildTaskInputFromReceipt(
	content: string,
	intake: TelegramReceiptIntake,
	activeTask?: TelegramActiveTaskContext | null,
): string | null {
	if (!shouldEnqueueReceiptIntake(intake)) {
		return null;
	}

	if (intake.messageKind === "blocked_answer" && activeTask) {
		return [
			"The user is replying to a blocked task.",
			activeTask.question ? `Blocked question: ${activeTask.question}` : null,
			`Resume the current task using this answer:\n${content}`,
		]
			.filter(Boolean)
			.join("\n\n");
	}

	if (intake.messageKind === "task_update" && activeTask) {
		return [
			"This is a follow-up update to the current task.",
			`Current task status: ${activeTask.status}`,
			`Current task summary: ${activeTask.preview}`,
			`Apply this user update while continuing the task:\n${content}`,
		].join("\n\n");
	}

	return content;
}

async function generateReceiptIntake(
	context: TelegramReceiptContext,
	signal: AbortSignal,
): Promise<string> {
	const model = createConfiguredLanguageModel();
	const result = await generateText({
		model,
		system: [
			"You classify incoming Telegram messages for a personal AI assistant.",
			"Return JSON only, with no markdown or prose outside the JSON.",
			"Always keep the reply in the same language as the user's current message.",
			"If the language is ambiguous, use preferredLanguage if provided, otherwise English.",
			"When there is an active task, default to messageKind='task_update' unless the message is clearly a status check or clearly a separate new request.",
			"If the active task is blocked and the user message looks like an answer, prefer messageKind='blocked_answer'.",
			"The reply must be short, natural, and specific about what was received and what happens next.",
		].join(" "),
		prompt: JSON.stringify({
			content: context.content,
			attachmentKind: context.attachmentKind,
			hasFileAttachment: context.hasFileAttachment,
			backlogCount: context.backlogCount,
			preferredLanguage: context.preferredLanguage || null,
			activeTask: context.activeTask || null,
			requiredShape: {
				language: "BCP47-like short code such as en, pt, es",
				messageKind: "new_task | task_update | status_check | blocked_answer",
				attachmentKind:
					"none | photo | document | video | audio | voice | file",
				understoodGoal: "one short sentence",
				nextStep: "one short sentence",
				reply: "one short sentence in the user's language",
				missingInfo: "optional short sentence or null",
			},
		}),
		maxOutputTokens: 180,
		temperature: 0.2,
		maxRetries: 0,
		abortSignal: signal,
	});

	return result.text;
}

export async function composeTelegramReceipt(
	context: TelegramReceiptContext,
	options: TelegramReceiptComposerOptions = {},
): Promise<TelegramReceiptResult> {
	const timeoutMs = options.timeoutMs ?? 1_500;
	const generateIntake = options.generateIntake ?? generateReceiptIntake;
	const fallbackAck =
		options.fallbackAck ??
		((ackContext) =>
			composeQueuedTelegramAck(ackContext, {
				timeoutMs: Math.min(750, timeoutMs),
			}));
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const raw = await generateIntake(context, controller.signal);
		const parsed = IntakeSchema.parse(JSON.parse(raw));
		const text = sanitizeReceiptText(parsed.reply);
		if (!text) {
			throw new Error("Invalid receipt text");
		}

		const intake: TelegramReceiptIntake = {
			...parsed,
			reply: text,
		};
		return {
			text,
			intake,
			usedFallback: false,
			shouldEnqueue: shouldEnqueueReceiptIntake(intake),
			taskInput: buildTaskInputFromReceipt(
				context.content,
				intake,
				context.activeTask,
			),
		};
	} catch (err) {
		console.warn("[TelegramReceipt] Falling back to generic ack:", err);
		const fallbackText = await fallbackAck(context);
		const intake = buildFallbackIntake(context, fallbackText);
		return {
			text: fallbackText,
			intake,
			usedFallback: true,
			shouldEnqueue: shouldEnqueueReceiptIntake(intake),
			taskInput: buildTaskInputFromReceipt(
				context.content,
				intake,
				context.activeTask,
			),
		};
	} finally {
		clearTimeout(timer);
	}
}
