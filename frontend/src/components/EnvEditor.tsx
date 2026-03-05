import { CheckCircle2, RefreshCwIcon, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import Editor from "react-simple-code-editor";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "./ui/accordion";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

// Simple .env syntax highlighting using bash-like syntax
const highlightEnv = (code: string): string => {
	const lines = code.split("\n");
	return lines
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return "";
			if (trimmed.startsWith("#")) {
				return `<span style="color: #6a9955">${escapeHtml(line)}</span>`;
			}
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex > 0) {
				const key = escapeHtml(trimmed.slice(0, eqIndex));
				const value = escapeHtml(trimmed.slice(eqIndex + 1));
				return `<span style="color: #9cdcfe">${key}</span>=<span style="color: #ce9178">${value}</span>`;
			}
			return escapeHtml(line);
		})
		.join("\n");
};

const escapeHtml = (str: string): string => {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
};

export function EnvEditor({
	open,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
}) {
	const [envContent, setEnvContent] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [saveResult, setSaveResult] = useState<{
		success?: boolean;
		message?: string;
	} | null>(null);

	// Load current .env file when dialog opens
	useEffect(() => {
		if (!open) return;

		const loadEnv = async () => {
			setIsLoading(true);
			try {
				const response = await fetch("/api/config/env");
				if (response.ok) {
					const content = await response.text();
					setEnvContent(content);
				} else {
					setSaveResult({
						success: false,
						message: "Failed to load .env file",
					});
				}
			} catch (err) {
				setSaveResult({
					success: false,
					message: err instanceof Error ? err.message : "Failed to load",
				});
			} finally {
				setIsLoading(false);
			}
		};

		loadEnv();
	}, [open]);

	const handleSave = async () => {
		setIsLoading(true);
		setSaveResult(null);

		try {
			const response = await fetch("/api/config/env", {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: envContent,
			});

			if (response.ok) {
				setSaveResult({
					success: true,
					message: "Environment variables saved!",
				});
				onSaved?.();
				setTimeout(() => onOpenChange(false), 1500);
			} else {
				setSaveResult({ success: false, message: "Failed to save .env file" });
			}
		} catch (err) {
			setSaveResult({
				success: false,
				message: err instanceof Error ? err.message : "Failed to save",
			});
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>
						<div className="flex items-center gap-2">
							<Settings2 className="h-5 w-5" />
							<span className="font-retro text-lg">ENVIRONMENT VARIABLES</span>
						</div>
					</DialogTitle>
					<DialogDescription>
						Edit .env file directly. Changes take effect immediately.
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-hidden flex flex-col p-6 bg-background">
					{/* Save result notification */}
					{saveResult && (
						<div
							className={`rounded-lg p-4 mb-4 flex items-center gap-2 ${
								saveResult.success
									? "bg-green-500/10 text-green-600"
									: "bg-destructive/10 text-destructive"
							}`}
						>
							{saveResult.success ? (
								<CheckCircle2 className="h-5 w-5" />
							) : (
								<RefreshCwIcon className="h-5 w-5" />
							)}
							<span className="text-sm font-medium">{saveResult.message}</span>
						</div>
					)}

					{/* Collapsible Help section */}
					<Accordion type="single" collapsible className="mb-4 flex-shrink-0">
						<AccordionItem value="info" className="border-muted">
							<AccordionTrigger className="hover:no-underline">
								<div className="flex items-center gap-2 text-sm">
									<RefreshCwIcon className="h-4 w-4" />
									<span>Environment File Info</span>
								</div>
							</AccordionTrigger>
							<AccordionContent>
								<div className="pl-6 text-sm">
									<p className="text-muted-foreground">
										Located at{" "}
										<code className="text-xs">/app/ws/config/.env</code>. Each
										line should be in <code className="text-xs">KEY=VALUE</code>{" "}
										format.
									</p>
									<ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
										<li>
											Secret keys ending in{" "}
											<code className="text-xs">_API_KEY</code> or{" "}
											<code className="text-xs">_TOKEN</code> are masked from
											model
										</li>
										<li>
											The model can add new variables via{" "}
											<code className="text-xs">set_env_var</code> tool during
											conversation
										</li>
									</ul>
								</div>
							</AccordionContent>
						</AccordionItem>
					</Accordion>

					{/* Code Editor with syntax highlighting */}
					<div className="flex-1 min-h-0 relative border rounded-md bg-[#1e1e1e] overflow-auto">
						<Editor
							value={envContent}
							onValueChange={setEnvContent}
							highlight={highlightEnv}
							padding={16}
							className="font-mono text-sm min-h-[300px] focus:outline-none"
							textareaClassName="focus:outline-none"
							style={{
								backgroundColor: "#1e1e1e",
								fontFamily:
									'"Fira Code", "Fira Mono", Consolas, Monaco, monospace',
								fontSize: 13,
								lineHeight: 1.5,
							}}
						/>
					</div>

					{/* Footer with save button */}
					<div className="shrink-0 pt-4 flex justify-end">
						<Button
							onClick={handleSave}
							disabled={isLoading || !envContent.trim()}
							variant="default"
							size="default"
						>
							{isLoading ? "Saving..." : "Save Changes"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
