import { CheckCircle2, RefreshCwIcon, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import Editor from "react-simple-code-editor";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card";
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

type EnvEditorProps = {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onSaved?: () => void;
	inline?: boolean;
};

type AiProviderId = "openrouter" | "openai-codex";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type AiProviderOption = {
	id: AiProviderId;
	label: string;
	auth: {
		configured: boolean;
		label?: string;
		source?: string;
	};
	configured: boolean;
	modelCount: number;
	selected: boolean;
};

type AiModelOption = {
	ref: string;
	provider: string;
	modelId: string;
	name: string;
	baseUrl?: string;
	api?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning: boolean;
	selected: boolean;
};

type ThinkingLevelOption = {
	value: ThinkingLevel;
	label: string;
	description: string;
};

type AiPreferences = {
	selectedModelRef?: string;
	effectiveModelRef?: string;
	selectedProviderId?: AiProviderId;
	thinkingLevel: ThinkingLevel;
	providerOptions: AiProviderOption[];
	models: AiModelOption[];
	thinkingLevels: ThinkingLevelOption[];
};

type AiModelsResponse = {
	provider: AiProviderId;
	configured: boolean;
	models: AiModelOption[];
};

type ChatGptLoginState = {
	status:
		| "idle"
		| "starting"
		| "awaiting_verification"
		| "authenticated"
		| "error";
	userCode?: string;
	verificationUri?: string;
	error?: string;
};

type AiStatus = {
	configured: boolean;
	provider?: string;
	model?: string;
	selectedModelRef?: string;
	selectedProviderId?: AiProviderId;
	effectiveModelRef?: string;
	thinkingLevel?: ThinkingLevel;
	errorMessage?: string;
	metadata?: {
		provider: string;
		modelId: string;
		name: string;
		baseUrl?: string;
		api?: string;
		contextWindow?: number;
		maxTokens?: number;
	} | null;
	providers?: {
		openrouter?: { configured: boolean };
		"openai-codex"?: { configured: boolean };
	};
	chatgptLogin?: ChatGptLoginState;
};

export function EnvEditor({
	open = false,
	onOpenChange,
	onSaved,
	inline = false,
}: EnvEditorProps) {
	const [envContent, setEnvContent] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [saveResult, setSaveResult] = useState<{
		success?: boolean;
		message?: string;
	} | null>(null);
	const [aiPreferences, setAiPreferences] = useState<AiPreferences | null>(
		null,
	);
	const [selectedProviderId, setSelectedProviderId] =
		useState<AiProviderId>("openai-codex");
	const [selectedModelRef, setSelectedModelRef] = useState("");
	const [selectedThinkingLevel, setSelectedThinkingLevel] =
		useState<ThinkingLevel>("medium");
	const [providerModels, setProviderModels] = useState<AiModelOption[]>([]);
	const [isSavingAiPreferences, setIsSavingAiPreferences] = useState(false);
	const [aiPreferencesMessage, setAiPreferencesMessage] = useState<
		string | null
	>(null);
	const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
	const [isConnectingChatGpt, setIsConnectingChatGpt] = useState(false);
	const [chatGptMessage, setChatGptMessage] = useState<string | null>(null);

	// Load current .env file when dialog opens
	useEffect(() => {
		if (!inline && !open) return;

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
	}, [inline, open]);

	useEffect(() => {
		if (!inline && !open) return;

		const loadAiPreferences = async () => {
			try {
				const response = await fetch("/api/ai/preferences");
				if (!response.ok) return;
				const payload = (await response.json()) as AiPreferences;
				setAiPreferences(payload);
				const nextProviderId =
					payload.selectedProviderId ||
					payload.providerOptions.find((provider) => provider.selected)?.id ||
					payload.providerOptions.find((provider) => provider.configured)?.id ||
					"openai-codex";
				setSelectedProviderId(nextProviderId);
				setSelectedModelRef(payload.selectedModelRef ?? "");
				setSelectedThinkingLevel(payload.thinkingLevel ?? "medium");
			} catch {
				// Non-fatal for the editor
			}
		};

		loadAiPreferences();
	}, [inline, open]);

	useEffect(() => {
		if (!inline && !open) return;

		const loadAiStatus = async () => {
			try {
				const response = await fetch("/api/ai/status");
				if (!response.ok) return;
				const payload = (await response.json()) as AiStatus;
				setAiStatus(payload);
			} catch {
				// Non-fatal for the editor
			}
		};

		loadAiStatus();
	}, [inline, open]);

	useEffect(() => {
		if (!inline && !open) return;

		const loadProviderModels = async () => {
			try {
				const response = await fetch(
					`/api/ai/models?provider=${selectedProviderId}`,
				);
				if (!response.ok) {
					setProviderModels([]);
					return;
				}
				const payload = (await response.json()) as AiModelsResponse;
				const models = payload.models ?? [];
				setProviderModels(models);
				setSelectedModelRef((current) => {
					if (current && models.some((model) => model.ref === current)) {
						return current;
					}
					return models[0]?.ref ?? "";
				});
			} catch {
				// Non-fatal for the editor
			}
		};

		loadProviderModels();
	}, [inline, open, selectedProviderId]);

	useEffect(() => {
		if (!inline && !open) return;
		const loginState = aiStatus?.chatgptLogin?.status;
		if (loginState !== "starting" && loginState !== "awaiting_verification") {
			return;
		}

		const timer = setInterval(() => {
			fetch("/api/ai/status")
				.then((response) => (response.ok ? response.json() : null))
				.then((payload: AiStatus | null) => {
					if (payload) {
						setAiStatus(payload);
					}
				})
				.catch(() => undefined);
		}, 3000);

		return () => clearInterval(timer);
	}, [aiStatus?.chatgptLogin?.status, inline, open]);

	const handleConnectChatGpt = async () => {
		setIsConnectingChatGpt(true);
		setChatGptMessage(null);

		try {
			const response = await fetch("/api/ai/login/chatgpt", {
				method: "POST",
			});
			const payload = (await response.json().catch(() => null)) as {
				state?: ChatGptLoginState;
				error?: string;
			} | null;

			if (!response.ok) {
				throw new Error(payload?.error || "Failed to start ChatGPT login");
			}

			if (payload?.state?.status === "awaiting_verification") {
				setAiStatus((prev) =>
					prev
						? {
								...prev,
								chatgptLogin: payload.state,
							}
						: prev,
				);
				setChatGptMessage(
					`Open ${payload.state.verificationUri} and enter code ${payload.state.userCode}`,
				);
				return;
			}

			await fetch("/api/ai/status")
				.then((response) => (response.ok ? response.json() : null))
				.then((payloadStatus: AiStatus | null) => {
					if (payloadStatus) {
						setAiStatus(payloadStatus);
					}
				});
		} catch (err) {
			setChatGptMessage(
				err instanceof Error ? err.message : "Failed to start ChatGPT login",
			);
		} finally {
			setIsConnectingChatGpt(false);
		}
	};

	const handleSaveAiPreferences = async () => {
		setIsSavingAiPreferences(true);
		setAiPreferencesMessage(null);

		try {
			const response = await fetch("/api/ai/preferences", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					modelRef: selectedModelRef || null,
					thinkingLevel: selectedThinkingLevel,
				}),
			});

			const payload = (await response.json().catch(() => null)) as
				| AiPreferences
				| { error?: string }
				| null;

			if (!response.ok) {
				throw new Error(
					(payload && "error" in payload && payload.error) ||
						"Failed to save AI preferences",
				);
			}

			if (payload && "providerOptions" in payload) {
				setAiPreferences(payload);
				const nextProviderId =
					payload.selectedProviderId ||
					payload.providerOptions.find((provider) => provider.selected)?.id ||
					payload.providerOptions.find((provider) => provider.configured)?.id ||
					selectedProviderId;
				setSelectedProviderId(nextProviderId);
				setSelectedThinkingLevel(payload.thinkingLevel ?? "medium");
			}

			await fetch("/api/ai/status")
				.then((statusResponse) =>
					statusResponse.ok ? statusResponse.json() : null,
				)
				.then((payloadStatus: AiStatus | null) => {
					if (payloadStatus) {
						setAiStatus(payloadStatus);
					}
				});

			setAiPreferencesMessage("AI preferences saved.");
		} catch (err) {
			setAiPreferencesMessage(
				err instanceof Error ? err.message : "Failed to save AI preferences",
			);
		} finally {
			setIsSavingAiPreferences(false);
		}
	};

	const providerOptions = aiPreferences?.providerOptions ?? [];
	const selectedProviderOption =
		providerOptions.find((provider) => provider.id === selectedProviderId) ??
		providerOptions.find((provider) => provider.selected) ??
		providerOptions.find((provider) => provider.configured) ??
		providerOptions[0];
	const visibleModels = providerModels;
	const activeModelLabel = selectedModelRef
		? visibleModels.find((model) => model.ref === selectedModelRef)?.name ||
			selectedModelRef
		: "Select a model";

	const handleProviderChange = (nextProviderId: AiProviderId) => {
		setSelectedProviderId(nextProviderId);
		setSelectedModelRef("");
	};

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
				if (!inline && onOpenChange) {
					setTimeout(() => onOpenChange(false), 1500);
				}
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

	const thinkingLevelOptions = aiPreferences?.thinkingLevels ?? [
		{
			value: "off" as const,
			label: "Off",
			description: "Minimize reasoning output and keep responses direct.",
		},
		{
			value: "minimal" as const,
			label: "Minimal",
			description: "Use the lightest reasoning mode available.",
		},
		{
			value: "low" as const,
			label: "Low",
			description: "Favor shorter internal reasoning.",
		},
		{
			value: "medium" as const,
			label: "Medium",
			description: "Balanced reasoning depth for most tasks.",
		},
		{
			value: "high" as const,
			label: "High",
			description: "Spend more effort on harder tasks.",
		},
		{
			value: "xhigh" as const,
			label: "Max",
			description: "Use the strongest reasoning level the model supports.",
		},
	];
	const editorArea = (
		<div className="space-y-4">
			<div className="rounded-lg border bg-muted/20 px-4 py-3 space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<div className="text-sm font-medium">AI Providers</div>
						<p className="text-xs text-muted-foreground">
							Pick a provider first, then choose from that provider&apos;s model
							list. This keeps OpenRouter and ChatGPT Plus separate and much
							easier to scan.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Badge variant="outline">
							OpenRouter{" "}
							{aiStatus?.providers?.openrouter?.configured
								? "connected"
								: "off"}
						</Badge>
						<Badge variant="outline">
							ChatGPT{" "}
							{aiStatus?.providers?.["openai-codex"]?.configured
								? "connected"
								: "off"}
						</Badge>
					</div>
				</div>

				<div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
					<div className="space-y-2">
						<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Provider
						</div>
						<select
							className="w-full rounded-md border bg-background px-3 py-2 text-sm"
							value={selectedProviderId}
							onChange={(event) =>
								handleProviderChange(event.target.value as AiProviderId)
							}
						>
							{providerOptions.map((provider) => (
								<option
									key={provider.id}
									value={provider.id}
									disabled={!provider.configured}
								>
									{provider.label}{" "}
									{provider.configured
										? `(${provider.modelCount} models)`
										: "(connect first)"}
								</option>
							))}
						</select>
						<p className="text-xs text-muted-foreground">
							{selectedProviderOption?.configured
								? `${selectedProviderOption.label} is connected and ready.`
								: "Connect a provider before picking a model."}
						</p>
					</div>

					<div className="space-y-2">
						<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Model
						</div>
						<select
							className="w-full rounded-md border bg-background px-3 py-2 text-sm"
							value={selectedModelRef}
							onChange={(event) => setSelectedModelRef(event.target.value)}
							disabled={visibleModels.length === 0}
						>
							<option value="" disabled>
								{visibleModels.length > 0
									? "Choose a model"
									: "No models available"}
							</option>
							{visibleModels.map((model) => (
								<option key={model.ref} value={model.ref}>
									{model.name}
									{model.name !== model.modelId ? ` (${model.modelId})` : ""}
								</option>
							))}
						</select>
						<p className="text-xs text-muted-foreground">
							{visibleModels.length > 0
								? `${visibleModels.length} model${visibleModels.length === 1 ? "" : "s"} shown for ${selectedProviderOption?.label || "the selected provider"}.`
								: "No models are available for this provider yet."}
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<Button
						onClick={handleConnectChatGpt}
						disabled={
							isConnectingChatGpt ||
							!!aiStatus?.providers?.["openai-codex"]?.configured
						}
					>
						{isConnectingChatGpt
							? "Connecting..."
							: aiStatus?.providers?.["openai-codex"]?.configured
								? "ChatGPT Connected"
								: "Connect ChatGPT Plus"}
					</Button>
					{aiStatus?.provider && (
						<Badge variant="secondary">Active: {aiStatus.provider}</Badge>
					)}
					<Badge variant="outline">
						Model: {selectedProviderOption?.label || "Provider"} /{" "}
						{activeModelLabel}
					</Badge>
					{aiStatus?.thinkingLevel && (
						<Badge variant="outline">Reasoning: {aiStatus.thinkingLevel}</Badge>
					)}
				</div>

				{aiStatus?.chatgptLogin?.status === "awaiting_verification" && (
					<div className="rounded-md border bg-background px-3 py-2 text-sm space-y-1">
						<div className="text-muted-foreground">
							Finish the ChatGPT sign-in in your browser:
						</div>
						<a
							href={aiStatus.chatgptLogin.verificationUri}
							target="_blank"
							rel="noreferrer"
							className="font-medium underline underline-offset-4"
						>
							{aiStatus.chatgptLogin.verificationUri}
						</a>
						<div className="font-mono text-base">
							{aiStatus.chatgptLogin.userCode}
						</div>
					</div>
				)}

				{chatGptMessage && (
					<div className="rounded-md border bg-background px-3 py-2 text-sm">
						{chatGptMessage}
					</div>
				)}

				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-2">
						<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Reasoning
						</div>
						<select
							className="w-full rounded-md border bg-background px-3 py-2 text-sm"
							value={selectedThinkingLevel}
							onChange={(event) =>
								setSelectedThinkingLevel(event.target.value as ThinkingLevel)
							}
						>
							{thinkingLevelOptions.map((level) => (
								<option key={level.value} value={level.value}>
									{level.label}
								</option>
							))}
						</select>
						<p className="text-xs text-muted-foreground">
							{thinkingLevelOptions.find(
								(level) => level.value === selectedThinkingLevel,
							)?.description || "Balanced reasoning depth for most tasks."}
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
					<div className="text-xs text-muted-foreground">
						Model and reasoning changes persist to the workspace and apply to
						new agent runs.
					</div>
					<Button
						onClick={handleSaveAiPreferences}
						disabled={
							isSavingAiPreferences ||
							visibleModels.length === 0 ||
							!selectedModelRef
						}
					>
						{isSavingAiPreferences ? "Saving..." : "Save AI Settings"}
					</Button>
				</div>

				{aiPreferencesMessage && (
					<div className="rounded-md border bg-background px-3 py-2 text-sm">
						{aiPreferencesMessage}
					</div>
				)}

				{aiStatus?.errorMessage && (
					<div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{aiStatus.errorMessage}
					</div>
				)}
			</div>

			{saveResult && (
				<div
					className={`rounded-lg p-4 flex items-center gap-2 ${
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

			<Accordion type="single" collapsible className="flex-shrink-0">
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
								Located at <code className="text-xs">/app/ws/config/.env</code>.
								Each line should be in{" "}
								<code className="text-xs">KEY=VALUE</code>
								format.
							</p>
							<ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
								<li>
									Secret keys ending in{" "}
									<code className="text-xs">_API_KEY</code> or{" "}
									<code className="text-xs">_TOKEN</code> are masked from the
									model
								</li>
								<li>
									The agent can add new variables via{" "}
									<code className="text-xs">set_env_var</code> while processing
									Telegram messages
								</li>
								<li>
									AI provider and model are selected above, so you usually do
									not need to edit <code className="text-xs">AI_MODEL</code>{" "}
									manually.
								</li>
							</ul>
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>

			<div className="relative border rounded-md bg-[#1e1e1e] overflow-auto">
				<Editor
					value={envContent}
					onValueChange={setEnvContent}
					highlight={highlightEnv}
					padding={16}
					className="font-mono text-sm min-h-[300px] focus:outline-none"
					textareaClassName="focus:outline-none"
					style={{
						backgroundColor: "#1e1e1e",
						fontFamily: '"Fira Code", "Fira Mono", Consolas, Monaco, monospace',
						fontSize: 13,
						lineHeight: 1.5,
					}}
				/>
			</div>

			<div className="flex justify-end">
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
	);

	if (inline) {
		return (
			<Card className="gap-0 py-0 overflow-hidden">
				<CardHeader className="border-b px-6 py-5">
					<CardTitle>
						<div className="flex items-center gap-2">
							<Settings2 className="h-5 w-5" />
							<span className="font-retro text-lg">ENVIRONMENT VARIABLES</span>
						</div>
					</CardTitle>
					<CardDescription>
						Edit /app/ws/config/.env directly. Changes take effect immediately.
					</CardDescription>
				</CardHeader>
				<CardContent className="px-6 py-6">{editorArea}</CardContent>
			</Card>
		);
	}

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
						Edit /app/ws/config/.env directly. Changes take effect immediately.
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-hidden flex flex-col p-6 bg-background">
					{editorArea}
				</div>
			</DialogContent>
		</Dialog>
	);
}
