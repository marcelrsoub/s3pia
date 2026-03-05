import { Telescope } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { FileAttachment as FileAttachmentType } from "@/hooks/useWebSocket";
import type { MessageType } from "@/lib/conversation";
import { FileAttachment } from "./FileAttachment";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

import "highlight.js/styles/github-dark.css";

interface MessageProps {
	role: MessageType;
	content: string;
	showTyping?: boolean;
	files?: FileAttachmentType[];
	source?: "web" | "telegram";
	timestamp?: Date;
}

const messageConfig = {
	user: {
		alignClass: "ml-auto",
		cardClass: "bg-primary text-primary-foreground",
		roleLabel: "USER",
		roleBadgeClass: "bg-primary-foreground/20 text-primary-foreground",
	},
	assistant: {
		alignClass: "mr-auto",
		cardClass: "bg-muted text-muted-foreground",
		roleLabel: "SEPIABOT",
		roleBadgeClass: "bg-muted-foreground/20 text-muted-foreground",
	},
	error: {
		alignClass: "mr-auto",
		cardClass: "bg-destructive text-destructive-foreground",
		roleLabel: "ERROR",
		roleBadgeClass: "bg-destructive-foreground/20 text-destructive-foreground",
	},
	system: {
		alignClass: "mx-auto max-w-fit",
		cardClass: "bg-muted/50 text-muted-foreground text-center",
		roleLabel: "SYSTEM",
		roleBadgeClass: "hidden",
	},
	worker: {
		alignClass: "mx-auto max-w-fit",
		cardClass: "bg-muted/30 text-muted-foreground border-l-2 border-blue-500",
		roleLabel: "WORKER",
		roleBadgeClass: "bg-blue-500/20 text-blue-400",
	},
};

export function Message({
	role,
	content,
	showTyping = false,
	files,
	source,
	timestamp,
}: MessageProps) {
	const config = messageConfig[role];
	const [displayText, setDisplayText] = useState("");

	// Telegram-specific styling
	const isTelegram = source === "telegram";
	const telegramBorderClass = isTelegram ? "border-2 border-blue-500/50" : "";
	const telegramBadgeClass = isTelegram
		? "bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1.5"
		: config.roleBadgeClass;
	const roleLabel =
		isTelegram && role === "user" ? "TELEGRAM" : config.roleLabel;

	// Animate text for streaming/typing effect
	useEffect(() => {
		if (showTyping) {
			setDisplayText(content);
		} else {
			setDisplayText(content);
		}
	}, [content, showTyping]);

	// Format timestamp for display (retro HH:MM:SS format)
	const formatTimestamp = (date: Date): { time: string; fullDate?: string } => {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / 86400000);

		const hours = date.getHours().toString().padStart(2, "0");
		const minutes = date.getMinutes().toString().padStart(2, "0");
		const seconds = date.getSeconds().toString().padStart(2, "0");
		const time = `${hours}:${minutes}:${seconds}`;

		if (diffDays >= 1) {
			const fullDate = date.toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
			});
			return { time, fullDate };
		}

		return { time };
	};

	// Validate timestamp and format for display
	const isValidDate = timestamp instanceof Date && !isNaN(timestamp.getTime());
	const timestampData = isValidDate ? formatTimestamp(timestamp) : null;

	// For user messages, don't render markdown to keep it simple
	// For assistant/error messages, render markdown
	const shouldRenderMarkdown = role === "assistant" || role === "error";

	return (
		<div className={`flex w-full ${config.alignClass} max-w-[85%]`}>
			<Card
				className={`px-4 py-3 ${config.cardClass} overflow-hidden ${telegramBorderClass} message-card ${role === "user" ? "user" : ""}`}
			>
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						{(role === "assistant" || role === "error" || isTelegram) && (
							<Badge
								variant="outline"
								className={`mb-2 text-xs ${telegramBadgeClass}`}
							>
								{isTelegram && <Telescope className="h-3 w-3 mr-1" />}
								{roleLabel}
							</Badge>
						)}
					</div>
					{timestampData && (
						<span className="opacity-60 whitespace-nowrap self-start">
							{timestampData.fullDate && (
								<span className="mr-2">{timestampData.fullDate}</span>
							)}
							{timestampData.time}
						</span>
					)}
				</div>
				<div className="prose prose-invert prose-sm max-w-full break-words">
					{shouldRenderMarkdown ? (
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							rehypePlugins={[rehypeHighlight]}
							components={{
								// Custom components for markdown elements
								p: ({ children }) => (
									<p className="mb-2 last:mb-0">{children}</p>
								),
								ul: ({ children }) => (
									<ul className="list-disc pl-4 mb-2">{children}</ul>
								),
								ol: ({ children }) => (
									<ol className="list-decimal pl-4 mb-2">{children}</ol>
								),
								li: ({ children }) => <li className="mb-1">{children}</li>,
								code: ({ className, children, ...props }) =>
									className?.includes("language-") ? (
										<code className={className} {...props}>
											{children}
										</code>
									) : (
										<code
											className="bg-muted-foreground/20 px-1.5 py-0.5 rounded text-xs font-mono"
											{...props}
										>
											{children}
										</code>
									),
								pre: ({ children }) => (
									<pre className="bg-muted-foreground/10 p-3 rounded-md overflow-x-auto mb-2">
										{children}
									</pre>
								),
								a: ({ href, children }) => (
									<a
										href={href}
										className="text-primary hover:underline"
										target="_blank"
										rel="noopener noreferrer"
									>
										{children}
									</a>
								),
								blockquote: ({ children }) => (
									<blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2">
										{children}
									</blockquote>
								),
								table: ({ children }) => (
									<div className="overflow-x-auto mb-2">
										<table className="min-w-full border border-muted-foreground/20">
											{children}
										</table>
									</div>
								),
								thead: ({ children }) => (
									<thead className="bg-muted-foreground/10">{children}</thead>
								),
								th: ({ children }) => (
									<th className="px-3 py-2 text-left border border-muted-foreground/20">
										{children}
									</th>
								),
								td: ({ children }) => (
									<td className="px-3 py-2 border border-muted-foreground/20">
										{children}
									</td>
								),
							}}
						>
							{displayText}
						</ReactMarkdown>
					) : (
						<div className="whitespace-pre-wrap break-words">
							{displayText}
							{showTyping && <TypingCursor />}
						</div>
					)}
				</div>
				{/* Render file attachments */}
				{files && files.length > 0 && (
					<div className="mt-3 space-y-2">
						{files.map((file, index) => (
							<FileAttachment
								key={`${file.path}-${index}`}
								filename={file.filename}
								path={file.path}
								size={file.size}
								downloadUrl={file.downloadUrl}
							/>
						))}
					</div>
				)}
			</Card>
		</div>
	);
}

function TypingCursor() {
	return <span className="terminal-cursor" />;
}
