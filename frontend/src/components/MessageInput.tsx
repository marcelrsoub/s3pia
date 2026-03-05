import { Send } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface MessageInputProps {
	onSend: (message: string) => void;
	disabled?: boolean;
	isLoading?: boolean;
}

export function MessageInput({
	onSend,
	disabled = false,
	isLoading = false,
}: MessageInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Auto-resize textarea
	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			const scrollHeight = textarea.scrollHeight;
			const maxHeight = 120;
			textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
		}
	}, [value]);

	const handleSend = () => {
		const trimmed = value.trim();
		if (trimmed && !disabled && !isLoading) {
			onSend(trimmed);
			setValue("");
			// Reset textarea height
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
			}
		}
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="flex items-end gap-2 p-4">
			<span className="terminal-prompt pb-2">▌</span>
			<Textarea
				ref={textareaRef}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Enter command..."
				disabled={disabled || isLoading}
				className="min-h-[44px] max-h-[120px] resize-none overflow-hidden"
				rows={1}
			/>
			<Button
				onClick={handleSend}
				disabled={disabled || isLoading || !value.trim()}
				size="icon"
				className="h-[44px] w-[44px] shrink-0"
			>
				<Send className="h-5 w-5" />
				<span className="sr-only">Send</span>
			</Button>
		</div>
	);
}
