/**
 * Base Channel Abstract Class
 *
 * All chat channels (Telegram, Discord, Web, etc.) extend this class.
 * Provides unified interface for channel lifecycle and message handling.
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

/**
 * Inbound message from a user
 */
export interface InboundMessage {
	/** Unique identifier for the sender */
	senderId: string;
	/** Message content */
	content: string;
	/** Conversation/session identifier */
	conversationId: string;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Outbound message to send to a user
 */
export interface OutboundMessage {
	/** Recipient identifier */
	recipientId: string;
	/** Message content */
	content: string;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Channel configuration
 */
export interface ChannelConfig {
	/** Channel is enabled */
	enabled: boolean;
	/** Allowed user IDs (empty = allow all) */
	allowFrom: string[];
}

/**
 * Abstract base class for all channels
 *
 * Channels must implement start, stop, and send methods.
 * Permission checking is provided by isAllowed().
 */
export abstract class BaseChannel {
	protected config: ChannelConfig;
	protected started = false;

	constructor(config: ChannelConfig) {
		this.config = config;
	}

	/**
	 * Start the channel (connect to service)
	 */
	abstract start(): Promise<void>;

	/**
	 * Stop the channel (disconnect from service)
	 */
	abstract stop(): Promise<void>;

	/**
	 * Send a message to a user
	 */
	abstract send(message: OutboundMessage): Promise<void>;

	/**
	 * Check if a sender is allowed to use this channel
	 *
	 * If allowFrom is empty, all users are allowed.
	 * Otherwise, only users in the allowFrom list are allowed.
	 */
	isAllowed(senderId: string): boolean {
		// No allow list = allow everyone
		if (!this.config.allowFrom || this.config.allowFrom.length === 0) {
			return true;
		}

		// Check if sender is in allow list
		return this.config.allowFrom.includes(senderId);
	}

	/**
	 * Check if channel is currently running
	 */
	isRunning(): boolean {
		return this.started;
	}

	/**
	 * Get channel name for logging
	 */
	abstract getName(): string;

	/**
	 * Get channel status for health checks
	 */
	getStatus(): { name: string; enabled: boolean; running: boolean } {
		return {
			name: this.getName(),
			enabled: this.config.enabled,
			running: this.started,
		};
	}
}
