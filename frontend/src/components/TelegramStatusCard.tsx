import {
	AlertTriangle,
	PauseCircle,
	RadioTower,
	RefreshCw,
} from "lucide-react";
import { ConnectionStatusIndicator } from "./ConnectionStatus";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card";

type TelegramStatus = {
	name?: string;
	enabled?: boolean;
	running?: boolean;
	configured?: boolean;
	error?: string;
	errorMessage?: string;
	status?: "idle" | "running" | "blocked";
	canCancel?: boolean;
	rerunRequested?: boolean;
	currentRun?: {
		id?: string;
		source?: "telegram" | "scheduled" | "manual";
		status: "idle" | "running" | "blocked";
		preview: string;
		question?: string;
		startedAt?: number;
		updatedAt?: number;
	} | null;
};

interface TelegramStatusCardProps {
	status: TelegramStatus | null;
	isLoading: boolean;
	isCancelling: boolean;
	onRefresh: () => void;
	onCancel: () => void;
	framed?: boolean;
}

export function getStatusLabel(
	status: TelegramStatus | null,
	isLoading: boolean,
): string {
	if (isLoading) return "Checking Telegram...";
	if (!status) return "No status available";
	if (status.currentRun?.status === "running") return "Live run is running";
	if (status.currentRun?.status === "blocked")
		return "Live run is waiting for you";
	if (status.running) return "Telegram connected";
	if (status.enabled === false) return "Telegram disabled or missing config";
	return "Telegram configured, idle";
}

function formatAge(timestamp?: number): string | null {
	if (!timestamp) return null;
	const elapsedMs = Math.max(0, Date.now() - timestamp);
	const elapsedMinutes = Math.floor(elapsedMs / 60_000);
	if (elapsedMinutes < 1) return "less than a minute";
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"}`;
	}
	const hours = Math.floor(elapsedMinutes / 60);
	const minutes = elapsedMinutes % 60;
	return `${hours}h ${minutes}m`;
}

export function TelegramStatusCard({
	status,
	isLoading,
	isCancelling,
	onRefresh,
	onCancel,
	framed = true,
}: TelegramStatusCardProps) {
	const connectionState = !status
		? "not_configured"
		: status.running
			? "connected"
			: status.enabled === false
				? "not_configured"
				: "disconnected";

	const errorText = status?.errorMessage || status?.error;
	const canCancel = Boolean(status?.canCancel && !isCancelling);

	const content = (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
				<ConnectionStatusIndicator status={connectionState} />
				<span>{getStatusLabel(status, isLoading)}</span>
			</div>

			{errorText && (
				<div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<span>{errorText}</span>
				</div>
			)}

			<div className="grid gap-3 text-sm sm:grid-cols-2">
				<div className="rounded-lg border bg-muted/30 px-4 py-3">
					<div className="text-muted-foreground">Channel</div>
					<div className="font-medium">{status?.name || "telegram"}</div>
				</div>
				<div className="rounded-lg border bg-muted/30 px-4 py-3">
					<div className="text-muted-foreground">State</div>
					<div className="font-medium">
						{status ? (status.configured === false ? "No" : "Yes") : "Unknown"}
					</div>
				</div>
			</div>

			{status?.currentRun && (
				<div className="space-y-3 rounded-xl border bg-card/70 p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="font-medium">Current run</div>
						<div className="text-xs text-muted-foreground">
							{status.currentRun.source || "telegram"}
							{status.rerunRequested ? " · update waiting" : ""}
						</div>
					</div>
					<div className="space-y-2 text-sm">
						<div className="rounded-lg border bg-muted/30 px-4 py-3">
							<div className="text-muted-foreground">Preview</div>
							<div className="font-medium leading-relaxed">
								{status.currentRun.preview || "No preview available"}
							</div>
						</div>
						{status.currentRun.question && (
							<div className="rounded-lg border bg-muted/30 px-4 py-3">
								<div className="text-muted-foreground">Question</div>
								<div className="font-medium leading-relaxed">
									{status.currentRun.question}
								</div>
							</div>
						)}
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="rounded-lg border bg-muted/30 px-4 py-3">
								<div className="text-muted-foreground">Started</div>
								<div className="font-medium">
									{formatAge(status.currentRun.startedAt) || "Unknown"}
								</div>
							</div>
							<div className="rounded-lg border bg-muted/30 px-4 py-3">
								<div className="text-muted-foreground">Updated</div>
								<div className="font-medium">
									{formatAge(status.currentRun.updatedAt) || "Unknown"}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);

	if (!framed) {
		return content;
	}

	return (
		<Card className="overflow-hidden">
			<CardHeader className="border-b">
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle>
							<div className="flex items-center gap-2">
								<RadioTower className="h-5 w-5" />
								<span className="font-retro text-lg">LIVE RUN</span>
							</div>
						</CardTitle>
						<CardDescription>
							{getStatusLabel(status, isLoading)}
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={onRefresh}
							disabled={isLoading}
						>
							<RefreshCw className="h-4 w-4" />
							<span className="ml-2">Refresh</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onCancel}
							disabled={!canCancel}
						>
							<PauseCircle className="h-4 w-4" />
							<span className="ml-2">
								{isCancelling ? "Cancelling" : "Cancel"}
							</span>
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="py-5">{content}</CardContent>
		</Card>
	);
}
