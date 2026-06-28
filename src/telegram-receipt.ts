import { generateText } from "ai";
import { z } from "zod";
import { createConfiguredLanguageModel } from "./model.js";
import {
	composeLiveTelegramAck,
	type TelegramAckContext,
} from "./telegram-ack.js";

export type TelegramMessageKind =
	| "new_run"
	| "live_update"
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

export interface TelegramActiveRunContext {
	status: "running" | "blocked";
	preview: string;
	question?: string;
}

export interface TelegramReceiptContext extends TelegramAckContext {
	attachmentKind: TelegramAttachmentKind;
	preferredLanguage?: string | null;
	activeRun?: TelegramActiveRunContext | null;
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
		"new_run",
		"live_update",
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
	const activeRun = context.activeRun;
	const normalizedContent = context.content.trim().toLowerCase();
	const statusCheckPhrase =
		/\b(hello|hi|hey|oi|ola|olá|hey there|you there|still there|checking in|any update|status|ping|tudo bem|tá tudo bem|are you there)\b/i.test(
			normalizedContent,
		);
	const punctuationOnly = /^[?.!?\s]+$/.test(normalizedContent);
	const shortStatusCheck =
		normalizedContent.length <= 24 && activeRun?.status !== "blocked";
	const likelyStatusCheck =
		statusCheckPhrase || punctuationOnly || shortStatusCheck;
	const defaultKind: TelegramMessageKind = activeRun
		? activeRun.status === "blocked"
			? likelyStatusCheck
				? "status_check"
				: "blocked_answer"
			: likelyStatusCheck
				? "status_check"
				: "live_update"
		: likelyStatusCheck
			? "status_check"
			: "new_run";

	return {
		language: inferLanguageHeuristic(
			context.content,
			context.preferredLanguage,
		),
		messageKind: defaultKind,
		attachmentKind: context.attachmentKind,
		understoodGoal: activeRun
			? defaultKind === "status_check"
				? "I received your check-in about the current run."
				: defaultKind === "blocked_answer"
					? "I received your answer for the blocked question."
					: "I received your update for the current run."
			: defaultKind === "status_check"
				? "I received your status check."
				: "I received your new request.",
		nextStep: activeRun
			? defaultKind === "status_check"
				? activeRun.status === "blocked"
					? "I’m waiting for your answer to continue."
					: "I’ll keep working and send progress or the result when it is ready."
				: defaultKind === "blocked_answer"
					? "I’ll use your answer and continue the same run."
					: "I’ll fold it into the current run."
			: defaultKind === "status_check"
				? "I’ll tell you the current state."
				: "I’ll review it and start the run.",
		reply:
			defaultKind === "status_check"
				? activeRun
					? activeRun.status === "blocked"
						? "I’m waiting for your answer to continue."
						: "I’m still working on the current run."
					: "I’m here. Send me what you want me to work on."
				: fallbackText,
		missingInfo: null,
	};
}

export function classifyTelegramReceiptIntake(
	context: TelegramReceiptContext,
	fallbackText = "Got it.",
): TelegramReceiptIntake {
	return buildFallbackIntake(context, fallbackText);
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
			"When there is an active run, default to messageKind='live_update' unless the message is clearly a status check or the run is blocked and the message looks like an answer.",
			"If there is no active run, prefer messageKind='new_run' unless the message is clearly a status check.",
			"The reply must be short, natural, and specific about what was received and what happens next.",
		].join(" "),
		prompt: JSON.stringify({
			content: context.content,
			attachmentKind: context.attachmentKind,
			hasFileAttachment: context.hasFileAttachment,
			isBusy: context.isBusy,
			preferredLanguage: context.preferredLanguage || null,
			activeRun: context.activeRun || null,
			requiredShape: {
				language: "BCP47-like short code such as en, pt, es",
				messageKind: "new_run | live_update | status_check | blocked_answer",
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
			composeLiveTelegramAck(ackContext, {
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
		};
	} catch (err) {
		console.warn("[TelegramReceipt] Falling back to generic ack:", err);
		const fallbackText = await fallbackAck(context);
		const intake = buildFallbackIntake(context, fallbackText);
		return {
			text: fallbackText,
			intake,
			usedFallback: true,
		};
	} finally {
		clearTimeout(timer);
	}
}
