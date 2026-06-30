import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import Editor from "react-simple-code-editor";
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
	framed?: boolean;
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
	framed = true,
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
	const visibleModels = providerModels;

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
			<div className="rounded-lg border bg-muted/20 p-4 space-y-3">
				<div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto_auto]">
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
								{provider.label}
							</option>
						))}
					</select>

					<select
						className="w-full rounded-md border bg-background px-3 py-2 text-sm"
						value={selectedModelRef}
						onChange={(event) => setSelectedModelRef(event.target.value)}
						disabled={visibleModels.length === 0}
					>
						<option value="" disabled>
							{visibleModels.length > 0 ? "Model" : "No models"}
						</option>
						{visibleModels.map((model) => (
							<option key={model.ref} value={model.ref}>
								{model.name}
							</option>
						))}
					</select>

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

					<Button
						variant="outline"
						size="sm"
						onClick={handleConnectChatGpt}
						disabled={
							isConnectingChatGpt ||
							!!aiStatus?.providers?.["openai-codex"]?.configured
						}
					>
						{isConnectingChatGpt
							? "Connecting..."
							: aiStatus?.providers?.["openai-codex"]?.configured
								? "ChatGPT"
								: "Connect"}
					</Button>

					<Button
						onClick={handleSaveAiPreferences}
						disabled={
							isSavingAiPreferences ||
							visibleModels.length === 0 ||
							!selectedModelRef
						}
					>
						{isSavingAiPreferences ? "Saving..." : "Save"}
					</Button>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
					<span>
						{aiStatus?.providers?.openrouter?.configured
							? "OpenRouter ready"
							: "OpenRouter off"}
						{" · "}
						{aiStatus?.providers?.["openai-codex"]?.configured
							? "ChatGPT ready"
							: "ChatGPT off"}
					</span>
					<span>{visibleModels.length} models</span>
				</div>

				{aiStatus?.chatgptLogin?.status === "awaiting_verification" && (
					<div className="rounded-md border bg-background px-3 py-2 text-sm">
						<a
							href={aiStatus.chatgptLogin.verificationUri}
							target="_blank"
							rel="noreferrer"
							className="font-medium underline underline-offset-4"
						>
							{aiStatus.chatgptLogin.verificationUri}
						</a>
						<span className="ml-3 font-mono">
							{aiStatus.chatgptLogin.userCode}
						</span>
					</div>
				)}

				{chatGptMessage && (
					<div className="rounded-md border bg-background px-3 py-2 text-sm">
						{chatGptMessage}
					</div>
				)}

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

				{saveResult && (
					<div className="text-sm text-muted-foreground">
						{saveResult.message}
					</div>
				)}
			</div>

			<div className="relative overflow-auto rounded-md border bg-[#1e1e1e]">
				<Editor
					value={envContent}
					onValueChange={setEnvContent}
					highlight={highlightEnv}
					padding={14}
					className="font-mono text-sm min-h-[280px] focus:outline-none"
					textareaClassName="focus:outline-none"
					style={{
						backgroundColor: "#1e1e1e",
						fontFamily: '"Fira Code", "Fira Mono", Consolas, Monaco, monospace',
						fontSize: 13,
						lineHeight: 1.5,
					}}
				/>
			</div>

			<div className="flex items-center justify-between gap-3">
				<div className="text-xs text-muted-foreground">/app/ws/config/.env</div>
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
		if (!framed) {
			return editorArea;
		}

		return (
			<Card className="gap-0 py-0 overflow-hidden">
				<CardHeader className="border-b px-6 py-5">
					<CardTitle>
						<div className="flex items-center gap-2">
							<Settings2 className="h-5 w-5" />
							<span className="font-retro text-lg">ENVIRONMENT</span>
						</div>
					</CardTitle>
					<CardDescription>Edit the workspace env file.</CardDescription>
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
							<span className="font-retro text-lg">ENVIRONMENT</span>
						</div>
					</DialogTitle>
					<DialogDescription>Edit the workspace env file.</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-hidden flex flex-col p-6 bg-background">
					{editorArea}
				</div>
			</DialogContent>
		</Dialog>
	);
}
