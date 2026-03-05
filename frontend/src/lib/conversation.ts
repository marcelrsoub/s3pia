import type { FileAttachment } from "@/hooks/useWebSocket";

/**
 * Default conversation ID for web UI and Telegram
 * Matches backend constant TELEGRAM.DEFAULT_CONVERSATION_ID
 */
const DEFAULT_CONVERSATION_ID = "default";

/**
 * Get or create a conversation ID from localStorage.
 * Persists across page refreshes for continuity.
 * Uses "default" for consistency with backend and Telegram integration.
 */
export function getOrCreateConversationId(): string {
	// Use "default" consistently for web UI to match backend behavior
	// This ensures Telegram messages appear in the web UI
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
 * Message types for the chat interface
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
	source?: "web" | "telegram"; // Track where the message originated
}

/**
 * Create a new message object
 */
export function createMessage(
	role: MessageType,
	content: string,
	files?: FileAttachment[],
	source?: "web" | "telegram",
	timestamp?: Date,
): Message {
	return {
		id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
		role,
		content,
		timestamp: timestamp || new Date(),
		files,
		source,
	};
}
