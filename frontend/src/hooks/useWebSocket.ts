import { useCallback, useEffect, useRef, useState } from "react";

// Simple fetch function to check config status (avoid circular dependency)
async function checkConfigStatus(): Promise<boolean> {
	try {
		const response = await fetch("/api/config/status");
		if (response.ok) {
			const data = await response.json();
			return data.configured === true;
		}
		return true; // If API fails, assume configured to avoid blocking
	} catch {
		return true; // If fetch fails, assume configured
	}
}

export type ConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected"
	| "not_configured";

export interface FileAttachment {
	filename: string;
	path: string;
	size?: number;
	downloadUrl: string;
}

export interface WebSocketMessage {
	type:
		| "status"
		| "content"
		| "error"
		| "history"
		| "cleared"
		| "pong"
		| "file"
		| "worker_status";
	content?: string;
	done?: boolean;
	error?: string;
	status?: string;
	messages?: Array<{
		role: string;
		content: string;
		source?: "web" | "telegram";
		timestamp: number;
		files?: FileAttachment[];
	}>;
	files?: FileAttachment[];
	workerType?: "tool";
	workerStatus?: "started" | "completed" | "failed";
	conversationId?: string;
	timestamp?: number;
}

export interface UseWebSocketReturn {
	status: ConnectionStatus;
	sendMessage: (message: string) => void;
	requestHistory: () => void;
	clearConversation: () => void;
	reconnect: () => void;
}

export interface UseWebSocketOptions {
	conversationId: string;
	onMessage?: (data: WebSocketMessage) => void;
	onStatusChange?: (status: ConnectionStatus) => void;
	reconnectDelay?: number;
	keepAliveInterval?: number;
}

export function useWebSocket({
	conversationId,
	onMessage,
	onStatusChange,
	reconnectDelay = 3000,
	keepAliveInterval = 30000,
}: UseWebSocketOptions): UseWebSocketReturn {
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const keepAliveTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(
		null,
	);

	const setStatusAndNotify = useCallback(
		(newStatus: ConnectionStatus) => {
			setStatus(newStatus);
			onStatusChange?.(newStatus);
		},
		[onStatusChange],
	);

	const connect = useCallback(async () => {
		if (
			wsRef.current &&
			(wsRef.current.readyState === WebSocket.CONNECTING ||
				wsRef.current.readyState === WebSocket.OPEN)
		) {
			return;
		}

		// Check if system is configured before connecting
		const isConfigured = await checkConfigStatus();
		if (!isConfigured) {
			setStatusAndNotify("not_configured");
			console.log("[WebSocket] System not configured, skipping connection");
			return;
		}

		setStatusAndNotify("connecting");

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws?conversationId=${conversationId}`;

		wsRef.current = new WebSocket(wsUrl);

		wsRef.current.addEventListener("open", () => {
			setStatusAndNotify("connected");
			console.log("[WebSocket] Connected");

			// Request conversation history on connect
			wsRef.current?.send(
				JSON.stringify({
					type: "history",
					conversationId,
				}),
			);

			// Clear any pending reconnect
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}

			// Set up keep-alive ping
			if (keepAliveTimeoutRef.current) {
				clearInterval(keepAliveTimeoutRef.current);
			}
			keepAliveTimeoutRef.current = setInterval(() => {
				if (wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(JSON.stringify({ type: "ping" }));
				}
			}, keepAliveInterval);
		});

		wsRef.current.addEventListener("message", (event) => {
			try {
				const data = JSON.parse(event.data) as WebSocketMessage;
				onMessage?.(data);
			} catch (err) {
				console.error("[WebSocket] Failed to parse message:", err);
			}
		});

		wsRef.current.addEventListener("close", () => {
			setStatusAndNotify("disconnected");
			console.log(
				"[WebSocket] Disconnected, reconnecting in",
				reconnectDelay,
				"ms",
			);

			// Clear keep-alive
			if (keepAliveTimeoutRef.current) {
				clearInterval(keepAliveTimeoutRef.current);
				keepAliveTimeoutRef.current = null;
			}

			// Schedule reconnect
			reconnectTimeoutRef.current = setTimeout(() => {
				connect();
			}, reconnectDelay);
		});

		wsRef.current.addEventListener("error", (err) => {
			console.error("[WebSocket] Error:", err);
			setStatusAndNotify("disconnected");
		});
	}, [
		conversationId,
		onMessage,
		reconnectDelay,
		keepAliveInterval,
		setStatusAndNotify,
	]);

	const sendMessage = useCallback(
		(message: string) => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(
					JSON.stringify({
						type: "chat",
						message,
						conversationId,
					}),
				);
			} else {
				console.warn("[WebSocket] Cannot send message: not connected");
			}
		},
		[conversationId],
	);

	const requestHistory = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(
				JSON.stringify({
					type: "history",
					conversationId,
				}),
			);
		}
	}, [conversationId]);

	const clearConversation = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(
				JSON.stringify({
					type: "clear",
					conversationId,
				}),
			);
		}
	}, [conversationId]);

	const reconnect = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close();
		}
		setTimeout(() => {
			connect();
		}, 100);
	}, [connect]);

	// Connect on mount
	useEffect(() => {
		connect();

		return () => {
			// Cleanup on unmount
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (keepAliveTimeoutRef.current) {
				clearInterval(keepAliveTimeoutRef.current);
			}
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, [connect]);

	// Reconnect when conversationId changes (for conversation switching)
	useEffect(() => {
		// Only reconnect if already connected (not on initial mount)
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			console.log("[WebSocket] Conversation ID changed, reconnecting...");
			wsRef.current.close();
			// Small delay to ensure clean close
			setTimeout(() => {
				connect();
			}, 100);
		}
	}, [conversationId, connect]);

	return {
		status,
		sendMessage,
		requestHistory,
		clearConversation,
		reconnect,
	};
}
