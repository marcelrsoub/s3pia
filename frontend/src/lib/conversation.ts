import type { FileAttachment } from "@/lib/channel-types";

/**
 * Shared conversation ID used for Telegram message history.
 * Matches the backend Telegram conversation namespace.
 */
const DEFAULT_CONVERSATION_ID = "default";

/**
 * Get the shared conversation ID.
 * The config UI does not maintain a separate chat surface.
 */
export function getOrCreateConversationId(): string {
	return DEFAULT_CONVERSATION_ID;
}

/**
 * Escape HTML to prevent XSS attacks.
 */
export function escapeHtml(text: string): string {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Format message content for display.
 * Currently just escapes HTML, but could be extended for markdown, etc.
 */
export function formatMessage(content: string): string {
	return escapeHtml(content);
}

/**
 * Message types for conversation data
 */
export type MessageType = "user" | "assistant" | "system" | "error" | "worker";

/**
 * Message structure
 */
export interface Message {
	id: string;
	role: MessageType;
	content: string;
	timestamp: Date;
	files?: FileAttachment[];
}

/**
 * Create a new message object
 */
export function createMessage(
	role: MessageType,
	content: string,
	files?: FileAttachment[],
	timestamp?: Date,
): Message {
	return {
		id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
		role,
		content,
		timestamp: timestamp || new Date(),
		files,
	};
}
