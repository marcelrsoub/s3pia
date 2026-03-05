import { useEffect, useState } from "react";

interface BotStatus {
	running: boolean;
	hasConflict: boolean;
	hasAuthError: boolean;
	errorMessage?: string;
}

export function useBotStatus() {
	const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const fetchBotStatus = async () => {
			try {
				const response = await fetch("/api/telegram/status");
				if (response.ok) {
					const data = (await response.json()) as BotStatus;
					setBotStatus(data);
				}
			} catch (err) {
				console.error("Failed to fetch bot status:", err);
			} finally {
				setIsLoading(false);
			}
		};

		fetchBotStatus();
		const interval = setInterval(fetchBotStatus, 5000); // Poll every 5 seconds
		return () => clearInterval(interval);
	}, []);

	return { botStatus, isLoading };
}
