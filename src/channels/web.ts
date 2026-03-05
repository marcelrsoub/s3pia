/**
 * Web Channel
 *
 * WebSocket/Web channel implementation extending BaseChannel.
 * Handles real-time communication with the web UI.
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import type { ServerWebSocket, WebSocketHandler } from "bun";
import { Agent } from "../agent.js";
import { conversationStore } from "../conversation.js";
import {
	BaseChannel,
	type ChannelConfig,
	type OutboundMessage,
} from "./base.js";

/**
 * WebSocket message types
 */
export type WSMessage =
	| { type: "chat"; message: string; conversationId?: string }
	| { type: "ping" }
	| { type: "clear"; conversationId?: string }
	| { type: "history"; conversationId?: string };

/**
 * WebSocket response types
 */
export type WSResponse =
	| {
			type: "content";
			content: string;
			done?: boolean;
			conversationId?: string;
	  }
	| { type: "error"; error: string }
	| {
			type: "history";
			messages: Array<{
				role: string;
				content: string;
				source?: "web" | "telegram";
				timestamp: number;
			}>;
	  }
	| { type: "cleared" }
	| { type: "pong" }
	| { type: "status"; status: string; conversationId?: string }
	| {
			type: "file";
			files: Array<{
				filename: string;
				path: string;
				size?: number;
				downloadUrl: string;
			}>;
	  };

/**
 * Web channel state
 */
interface WebChannelState {
	connections: Map<string, Set<ServerWebSocket<unknown>>>;
	wsToConversation: Map<ServerWebSocket<unknown>, string>;
}

/**
 * Web Channel (WebSocket)
 *
 * This is a special case - WebChannel doesn't fully implement the BaseChannel pattern
 * because it manages multiple WebSocket connections rather than sending to specific recipients.
 * However, it follows the same lifecycle pattern.
 */
export class WebChannel extends BaseChannel {
	private state: WebChannelState;
	private wsHandler: WebSocketHandler<unknown>;

	constructor(config: ChannelConfig) {
		super(config);
		this.state = {
			connections: new Map(),
			wsToConversation: new Map(),
		};

		// Create WebSocket handler
		this.wsHandler = this.createHandler();
	}

	/**
	 * Get channel name
	 */
	getName(): string {
		return "web";
	}

	/**
	 * Start web channel (no-op - server handles this)
	 */
	async start(): Promise<void> {
		this.started = true;
		console.log("[Web] Channel ready");
	}

	/**
	 * Stop web channel
	 */
	async stop(): Promise<void> {
		// Close all connections
		for (const [convId, connections] of this.state.connections) {
			for (const ws of connections) {
				if (ws.readyState === WebSocket.OPEN) {
					ws.close();
				}
			}
		}
		this.state.connections.clear();
		this.state.wsToConversation.clear();
		this.started = false;
		console.log("[Web] Channel stopped");
	}

	/**
	 * Send message to a specific conversation
	 */
	async send(message: OutboundMessage): Promise<void> {
		const connections = this.state.connections.get(message.recipientId);
		if (!connections) return;

		const response: WSResponse = {
			type: "content",
			content: message.content,
			done: true,
		};

		const data = JSON.stringify(response);
		for (const ws of connections) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(data);
			}
		}
	}

	/**
	 * Broadcast to all clients in a conversation
	 */
	broadcast(conversationId: string, message: WSResponse): void {
		const connections = this.state.connections.get(conversationId);
		if (!connections) {
			console.log(`[Web] No connections for conversation: ${conversationId}`);
			return;
		}

		if (message.type === "file") {
			console.log(
				`[Web] Broadcasting ${message.files?.length || 0} files to ${connections.size} clients`,
			);
		}
		const data = JSON.stringify(message);
		for (const ws of connections) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(data);
			}
		}
	}

	/**
	 * Get WebSocket handler for Bun.serve()
	 */
	getHandler(): WebSocketHandler<unknown> {
		return this.wsHandler;
	}

	/**
	 * Register WebSocket connection
	 */
	registerWebSocket(
		conversationId: string,
		ws: ServerWebSocket<unknown>,
	): void {
		if (!this.state.connections.has(conversationId)) {
			this.state.connections.set(conversationId, new Set());
		}
		this.state.connections.get(conversationId)?.add(ws);
		this.state.wsToConversation.set(ws, conversationId);
	}

	/**
	 * Unregister WebSocket connection
	 */
	unregisterWebSocket(
		conversationId: string,
		ws: ServerWebSocket<unknown>,
	): void {
		const connections = this.state.connections.get(conversationId);
		if (connections) {
			connections.delete(ws);
			if (connections.size === 0) {
				this.state.connections.delete(conversationId);
			}
		}
		this.state.wsToConversation.delete(ws);
	}

	/**
	 * Create WebSocket handler
	 */
	private createHandler(): WebSocketHandler<unknown> {
		return {
			message: (ws, message) => this.handleMessage(ws, message),
			open: (ws) => this.handleOpen(ws),
			close: (ws, _code, _message) => this.handleClose(ws),
			drain: (_ws) => {
				// Ready for more data
			},
		};
	}

	/**
	 * Handle incoming WebSocket message
	 */
	private handleMessage(
		ws: ServerWebSocket<unknown>,
		message: Buffer | string,
	): void {
		try {
			const data = JSON.parse(message.toString()) as WSMessage;
			const conversationId =
				data.conversationId || this.state.wsToConversation.get(ws) || "default";

			// Update conversation tracking
			if (
				data.conversationId &&
				this.state.wsToConversation.get(ws) !== data.conversationId
			) {
				const oldConvId = this.state.wsToConversation.get(ws);
				if (oldConvId) {
					this.unregisterWebSocket(oldConvId, ws);
				}
				this.registerWebSocket(conversationId, ws);
			}

			switch (data.type) {
				case "chat":
					this.processChat(data.message, conversationId, ws);
					break;
				case "ping":
					ws.send(JSON.stringify({ type: "pong" } as WSResponse));
					break;
				case "clear":
					conversationStore.clear(conversationId);
					ws.send(JSON.stringify({ type: "cleared" } as WSResponse));
					break;
				case "history":
					this.sendHistory(conversationId, ws);
					break;
				default:
					ws.send(
						JSON.stringify({
							type: "error",
							error: "Unknown message type",
						} as WSResponse),
					);
			}
		} catch {
			ws.send(
				JSON.stringify({
					type: "error",
					error: "Invalid message format",
				} as WSResponse),
			);
		}
	}

	/**
	 * Handle WebSocket connection open
	 */
	private handleOpen(ws: ServerWebSocket<unknown>): void {
		// Register to default conversation so broadcast messages can reach this connection
		this.registerWebSocket("default", ws);

		ws.send(
			JSON.stringify({
				type: "status",
				status: "connected",
			} as WSResponse),
		);
	}

	/**
	 * Handle WebSocket connection close
	 */
	private handleClose(ws: ServerWebSocket<unknown>): void {
		const conversationId = this.state.wsToConversation.get(ws);
		if (conversationId) {
			this.unregisterWebSocket(conversationId, ws);
		}
	}

	/**
	 * Process chat message
	 */
	private async processChat(
		message: string,
		conversationId: string,
		ws: ServerWebSocket<unknown>,
	): Promise<void> {
		console.log(`[Web] Processing message for conversation: ${conversationId}`);

		try {
			// Get or create conversation
			let conv = conversationStore.get(conversationId);
			if (!conv) {
				conv = conversationStore.create(conversationId);
			}

			// Get conversation history before adding new message
			const conversationHistory = conv.messages;

			// Add user message to conversation
			conversationStore.addMessage(conversationId, "user", message, "web");

			// Execute task using Agent with conversation history
			const agent = new Agent();
			const result = await agent.execute(message, conversationHistory, "web");

			// Handle blocked state
			if (result.blocked) {
				this.sendContent(
					ws,
					result.question || "I need more information to proceed.",
					true,
				);
				return;
			}

			// If agent didn't use send_message, send the result directly
			// Don't create a follow-up task to avoid re-doing expensive operations
			if (!result.usedSendMessage) {
				console.log(
					"[Web] Agent didn't use send_message, sending result directly",
				);
				const fallbackMessage = result.result || "Task completed";
				this.sendContent(ws, fallbackMessage, true);
				conversationStore.addMessage(
					conversationId,
					"assistant",
					fallbackMessage,
					"web",
				);
			}

			// Send done signal
			this.sendContent(ws, "", true);
		} catch (err) {
			console.error("[Web] Error processing message:", err);
			ws.send(
				JSON.stringify({
					type: "error",
					error: err instanceof Error ? err.message : "Unknown error",
				} as WSResponse),
			);
		}
	}

	/**
	 * Send content chunk to WebSocket
	 */
	private sendContent(
		ws: ServerWebSocket<unknown>,
		content: string,
		done: boolean,
	): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(
				JSON.stringify({
					type: "content",
					content,
					done,
				} as WSResponse),
			);
		}
	}

	/**
	 * Send conversation history
	 */
	private sendHistory(
		conversationId: string,
		ws: ServerWebSocket<unknown>,
	): void {
		const conv = conversationStore.get(conversationId);
		const messages = conv?.messages || [];
		ws.send(JSON.stringify({ type: "history", messages } as WSResponse));
	}
}

/**
 * Create web channel
 */
export function createWebChannel(): WebChannel {
	return new WebChannel({
		enabled: true,
		allowFrom: [], // Web UI is open to all
	});
}
