import { AlertTriangle, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBotStatus } from "@/hooks/useBotStatus";
import type { WebSocketMessage } from "@/hooks/useWebSocket";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Message, MessageType } from "@/lib/conversation";
import { createMessage } from "@/lib/conversation";
import { ConnectionStatusIndicator } from "./ConnectionStatus";
import { EnvEditor } from "./EnvEditor";
import { Logo } from "./Logo";
import { Message as MessageComponent } from "./Message";
import { MessageInput } from "./MessageInput";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

export function ChatContainer() {
	const conversationId = "default";
	const [messages, setMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [currentStreamingMessage, setCurrentStreamingMessage] =
		useState<string>("");
	const [currentStreamingFiles, setCurrentStreamingFiles] = useState<
		Array<{
			filename: string;
			path: string;
			size?: number;
			downloadUrl: string;
		}>
	>([]);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [showClearDialog, setShowClearDialog] = useState(false);
	const [open, setOpen] = useState(false);

	// Use ref to track if we're scrolling to avoid duplicate scrolls
	const isScrollingRef = useRef(false);

	// Use ref for streaming files to avoid callback dependency changes
	const currentStreamingFilesRef = useRef<typeof currentStreamingFiles>([]);

	// Stable callback for handling WebSocket messages
	// Uses ref for streaming files to avoid callback recreation (which causes WebSocket reconnection)
	const handleWebSocketMessage = useCallback(
		(data: WebSocketMessage) => {
			console.log("[ChatContainer] Received:", data);

			switch (data.type) {
				case "status":
					console.log("Server status:", data.status);
					break;

				case "content":
					if (data.done) {
						// Finalize the streaming message (don't double-add content)
						// Capture files IMMEDIATELY before any state updates
						const capturedFiles = [...currentStreamingFilesRef.current];
						const hasFiles = capturedFiles.length > 0;

						setCurrentStreamingMessage((prev) => {
							const finalContent = prev + (data.content || "");
							// Create message if there's content OR files
							if (finalContent || hasFiles) {
								setMessages((msgPrev) => [
									...msgPrev,
									createMessage("assistant", finalContent, capturedFiles),
								]);
							}
							return "";
						});
						currentStreamingFilesRef.current = [];
						setCurrentStreamingFiles([]);
						setIsLoading(false);
					} else if (data.content) {
						// Accumulate streaming content
						setCurrentStreamingMessage((prev) => prev + data.content);
					}
					break;

				case "file":
					// Handle file attachments
					if (data.files && data.files.length > 0) {
						currentStreamingFilesRef.current = data.files;
						setCurrentStreamingFiles(data.files);
					}
					break;

				case "error":
					setMessages((prev) => [
						...prev,
						createMessage("error", data.error || "An error occurred"),
					]);
					setCurrentStreamingMessage("");
					currentStreamingFilesRef.current = [];
					setCurrentStreamingFiles([]);
					setIsLoading(false);
					break;

				case "history":
					if (data.messages && data.messages.length > 0) {
						// Convert history messages to our Message format
						const historyMessages = data.messages
							.filter((msg) => msg.role !== "system")
							.map((msg) =>
								createMessage(
									msg.role as MessageType,
									msg.content,
									msg.files, // Include files from history
									msg.source,
									new Date(msg.timestamp),
								),
							);
						setMessages(historyMessages);
					}
					break;

				case "cleared":
					setMessages([createMessage("system", "Conversation cleared.")]);
					setCurrentStreamingMessage("");
					currentStreamingFilesRef.current = [];
					setCurrentStreamingFiles([]);
					setIsLoading(false);
					break;

				case "pong":
					// Keep-alive response, ignore
					break;
			}
		},
		[], // Empty deps - using ref to avoid WebSocket reconnection loop
	);

	// Stable callback for status changes
	const handleStatusChange = useCallback(() => {
		// Scroll to bottom on connection
		requestAnimationFrame(() => {
			if (scrollRef.current) {
				scrollRef.current.scrollIntoView({ behavior: "auto" });
			}
		});
	}, []);

	const { status, sendMessage, clearConversation, reconnect } = useWebSocket({
		conversationId,
		onMessage: handleWebSocketMessage,
		onStatusChange: handleStatusChange,
	});

	const { botStatus } = useBotStatus();

	const handleSend = useCallback(
		(message: string) => {
			// Add user message immediately
			setMessages((prev) => [...prev, createMessage("user", message)]);
			setIsLoading(true);
			sendMessage(message);
		},
		[sendMessage],
	);

	const handleClear = useCallback(() => {
		clearConversation();
		setShowClearDialog(false);
	}, [clearConversation]);

	// Scroll to bottom when messages or streaming content changes
	// Use a ref to track previous values and avoid unnecessary scrolls
	const prevMessagesLengthRef = useRef(0);
	const prevStreamingLengthRef = useRef(0);

	useEffect(() => {
		const messagesChanged = messages.length !== prevMessagesLengthRef.current;
		const streamingChanged =
			currentStreamingMessage.length !== prevStreamingLengthRef.current;

		// Only scroll if content actually changed
		if (messagesChanged || streamingChanged) {
			prevMessagesLengthRef.current = messages.length;
			prevStreamingLengthRef.current = currentStreamingMessage.length;

			if (!isScrollingRef.current) {
				isScrollingRef.current = true;
				requestAnimationFrame(() => {
					if (scrollRef.current) {
						scrollRef.current.scrollIntoView({ behavior: "auto" });
					}
					isScrollingRef.current = false;
				});
			}
		}
	}, [messages.length, currentStreamingMessage.length]);

	return (
		<>
			{/* Header - Fixed Floating Island */}
			<div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-3xl w-[calc(100%-2rem)]">
				<div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg">
					<div className="flex items-center justify-between px-4 py-3">
						<div className="flex items-center gap-3">
							<Logo className="h-7 w-auto text-primary" />
							<ConnectionStatusIndicator status={status} />
						</div>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setOpen(true)}
								className="text-muted-foreground hover:text-foreground"
								title="Environment variables"
							>
								<Settings2 className="h-5 w-5" />
								<span className="sr-only">Environment variables</span>
							</Button>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setShowClearDialog(true)}
								className="text-muted-foreground hover:text-destructive"
							>
								<Trash2 className="h-5 w-5" />
								<span className="sr-only">Clear conversation</span>
							</Button>
						</div>
					</div>
				</div>

				{/* Bot Error Warning Banner */}
				{botStatus?.hasAuthError && (
					<div className="mt-2 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
						<div className="flex items-start gap-3">
							<AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
							<div className="flex-1">
								<p className="font-medium text-destructive">
									Telegram Bot Authentication Failed
								</p>
								<p className="text-destructive/80 mt-1 text-sm">
									{botStatus.errorMessage ||
										"Please update your bot token in Settings"}
								</p>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Env Editor Dialog */}
			<EnvEditor open={open} onOpenChange={setOpen} onSaved={reconnect} />

			{/* Main Content - Page Scroll */}
			<div className="max-w-3xl w-full mx-auto px-4 pt-20 pb-32">
				<div className="flex flex-col gap-3 w-full">
					{/* Setup Required Prompt */}
					{status === "not_configured" && (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<div className="flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10 mb-4 border border-orange-500/30">
								<Settings2 className="h-8 w-8 text-orange-500" />
							</div>
							<h2 className="text-xl font-semibold mb-2 tracking-wide font-retro">
								INITIALIZE SEPIABOT
							</h2>
							<p className="text-muted-foreground mb-4 max-w-md">
								Configure your AI provider by clicking the gear icon above to
								begin.
							</p>
							<Button onClick={() => setOpen(true)} variant="outline">
								<Settings2 className="h-4 w-4 mr-2" />
								Open Settings
							</Button>
						</div>
					)}
					{messages.map((msg) => (
						<MessageComponent
							key={msg.id}
							role={msg.role}
							content={msg.content}
							files={msg.files}
							source={msg.source}
							timestamp={msg.timestamp}
						/>
					))}
					{currentStreamingMessage && (
						// biome-ignore lint/a11y/useValidAriaRole: role is a custom prop for Message component, not an ARIA role
						<MessageComponent
							role="assistant"
							content={currentStreamingMessage}
							showTyping
							files={currentStreamingFiles}
						/>
					)}
					<div ref={scrollRef} />
				</div>
			</div>

			{/* Input - Fixed Floating Island */}
			<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-3xl w-[calc(100%-2rem)]">
				<div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg">
					<MessageInput
						onSend={handleSend}
						disabled={status !== "connected"}
						isLoading={isLoading}
					/>
				</div>
			</div>
			<Dialog
				open={showClearDialog}
				onOpenChange={() => setShowClearDialog(false)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Clear Conversation</DialogTitle>
						<DialogDescription>
							Are you sure you want to clear the conversation history? This
							action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowClearDialog(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleClear}>
							Clear
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
