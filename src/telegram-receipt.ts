import {
	composeLiveTelegramAck,
	type TelegramAckContext,
} from "./telegram-ack.js";

export type TelegramMessageKind = "new_run" | "live_update" | "blocked_answer";

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
	fallbackAck?: (context: TelegramAckContext) => Promise<string>;
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
	const checkInPhrase =
		/\b(hello|hi|hey|oi|ola|olá|hey there|you there|still there|checking in|any update|status|ping|tudo bem|tá tudo bem|are you there)\b/i.test(
			normalizedContent,
		);
	const punctuationOnly = /^[?.!?\s]+$/.test(normalizedContent);
	const shortCheckIn =
		normalizedContent.length <= 24 && activeRun?.status !== "blocked";
	const likelyCheckIn = checkInPhrase || punctuationOnly || shortCheckIn;
	const defaultKind: TelegramMessageKind = activeRun
		? activeRun.status === "blocked"
			? likelyCheckIn
				? "live_update"
				: "blocked_answer"
			: "live_update"
		: "new_run";

	return {
		language: inferLanguageHeuristic(
			context.content,
			context.preferredLanguage,
		),
		messageKind: defaultKind,
		attachmentKind: context.attachmentKind,
		understoodGoal: activeRun
			? defaultKind === "blocked_answer"
				? "I received your answer for the blocked question."
				: "I received your update for the current run."
			: "I received your new request.",
		nextStep: activeRun
			? defaultKind === "blocked_answer"
				? "I’ll use your answer and continue the same run."
				: "I’ll fold it into the current run."
			: "I’ll review it and start the run.",
		reply:
			activeRun && defaultKind !== "blocked_answer"
				? "I’ll fold it into the current run."
				: defaultKind === "blocked_answer"
					? "I’ll use your answer and continue the same run."
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

export async function composeTelegramReceipt(
	context: TelegramReceiptContext,
	options: TelegramReceiptComposerOptions = {},
): Promise<TelegramReceiptResult> {
	const fallbackAck =
		options.fallbackAck ?? ((ackContext) => composeLiveTelegramAck(ackContext));
	const fallbackText = await fallbackAck(context);
	const intake = buildFallbackIntake(context, fallbackText);
	return {
		text: fallbackText,
		intake,
		usedFallback: true,
	};
}
