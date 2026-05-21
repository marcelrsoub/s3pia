import { useCallback, useEffect, useState } from "react";

interface TelegramStatus {
	name?: string;
	enabled?: boolean;
	running: boolean;
	configured?: boolean;
	hasConflict?: boolean;
	hasAuthError?: boolean;
	error?: string;
	errorMessage?: string;
}

export function useBotStatus() {
	const [botStatus, setBotStatus] = useState<TelegramStatus | null>(null);
	const [isLoading, setIsLoading] = useState(true);

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

	useEffect(() => {
		fetchBotStatus();
		const interval = setInterval(fetchBotStatus, 5000); // Poll every 5 seconds
		return () => clearInterval(interval);
	}, [fetchBotStatus]);

	return { botStatus, isLoading, refresh: fetchBotStatus };
}
