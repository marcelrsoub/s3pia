import { AlertTriangle, RadioTower, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card";
import { ConnectionStatusIndicator } from "./ConnectionStatus";

type TelegramStatus = {
	name?: string;
	enabled?: boolean;
	running?: boolean;
	configured?: boolean;
	error?: string;
	errorMessage?: string;
};

interface TelegramStatusCardProps {
	status: TelegramStatus | null;
	isLoading: boolean;
	onRefresh: () => void;
}

function getStatusLabel(
	status: TelegramStatus | null,
	isLoading: boolean,
): string {
	if (isLoading) return "Checking Telegram...";
	if (!status) return "No status available";
	if (status.running) return "Telegram connected";
	if (status.enabled === false) return "Telegram disabled or missing config";
	return "Telegram configured, not running";
}

export function TelegramStatusCard({
	status,
	isLoading,
	onRefresh,
}: TelegramStatusCardProps) {
	const connectionState = !status
		? "not_configured"
		: status.running
			? "connected"
			: status.enabled === false
				? "not_configured"
				: "disconnected";

	const errorText = status?.errorMessage || status?.error;
	const enabledLabel = status
		? status.enabled === false
			? "Disabled"
			: status.enabled
				? "Enabled"
				: "Unknown"
		: "Unknown";
	const runningLabel = status
		? status.running === true
			? "Running"
			: status.running === false
				? "Stopped"
				: "Unknown"
		: "Unknown";

	return (
		<Card className="overflow-hidden">
			<CardHeader className="border-b">
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle>
							<div className="flex items-center gap-2">
								<RadioTower className="h-5 w-5" />
								<span className="font-retro text-lg">TELEGRAM STATUS</span>
							</div>
						</CardTitle>
						<CardDescription>
							{getStatusLabel(status, isLoading)}
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={onRefresh}
						disabled={isLoading}
					>
						<RefreshCw className="h-4 w-4" />
						<span className="ml-2">Refresh</span>
					</Button>
				</div>
			</CardHeader>
			<CardContent className="py-6 space-y-4">
				<div className="flex items-center justify-between gap-4">
					<ConnectionStatusIndicator status={connectionState} />
					<div className="flex items-center gap-2">
						<Badge variant="outline">{enabledLabel}</Badge>
						<Badge variant="outline">{runningLabel}</Badge>
					</div>
				</div>

				{errorText && (
					<div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-3">
						<AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
						<span>{errorText}</span>
					</div>
				)}

				<div className="grid gap-3 sm:grid-cols-3 text-sm">
					<div className="rounded-lg border bg-muted/30 px-4 py-3">
						<div className="text-muted-foreground">Channel</div>
						<div className="font-medium">{status?.name || "telegram"}</div>
					</div>
					<div className="rounded-lg border bg-muted/30 px-4 py-3">
						<div className="text-muted-foreground">Configured</div>
						<div className="font-medium">
							{status
								? status.configured === false
									? "No"
									: "Yes"
								: "Unknown"}
						</div>
					</div>
					<div className="rounded-lg border bg-muted/30 px-4 py-3">
						<div className="text-muted-foreground">State</div>
						<div className="font-medium">
							{isLoading ? "Loading" : status?.running ? "Connected" : "Idle"}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
