import { useCallback, useEffect, useState } from "react";

type LiveRunStatus = "idle" | "running" | "blocked";

interface LiveRunSummary {
	id?: string;
	source?: "telegram" | "scheduled" | "manual";
	status: LiveRunStatus;
	preview: string;
	question?: string;
	startedAt?: number;
	updatedAt?: number;
}

interface TelegramStatus {
	name?: string;
	enabled?: boolean;
	running: boolean;
	configured?: boolean;
	hasConflict?: boolean;
	hasAuthError?: boolean;
	error?: string;
	errorMessage?: string;
	canCancel?: boolean;
	status?: LiveRunStatus;
	currentRun?: LiveRunSummary | null;
	rerunRequested?: boolean;
}

export function useBotStatus() {
	const [botStatus, setBotStatus] = useState<TelegramStatus | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isCancelling, setIsCancelling] = useState(false);

	const fetchBotStatus = useCallback(async () => {
		try {
			const response = await fetch("/api/telegram/status");
			if (response.ok) {
				const data = (await response.json()) as TelegramStatus;
				setBotStatus(data);
			}
		} catch (err) {
			console.error("Failed to fetch bot status:", err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const cancelCurrentRun = useCallback(async () => {
		setIsCancelling(true);
		try {
			const response = await fetch("/api/telegram/cancel", {
				method: "POST",
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			await fetchBotStatus();
		} catch (err) {
			console.error("Failed to cancel current run:", err);
		} finally {
			setIsCancelling(false);
		}
	}, [fetchBotStatus]);

	useEffect(() => {
		fetchBotStatus();
		const interval = setInterval(fetchBotStatus, 5000); // Poll every 5 seconds
		return () => clearInterval(interval);
	}, [fetchBotStatus]);

	return {
		botStatus,
		isLoading,
		isCancelling,
		refresh: fetchBotStatus,
		cancelCurrentRun,
	};
}
