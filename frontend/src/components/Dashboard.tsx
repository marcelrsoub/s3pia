import { Settings2, Shield } from "lucide-react";
import { useBotStatus } from "@/hooks/useBotStatus";
import { EnvEditor } from "./EnvEditor";
import { Logo } from "./Logo";
import { TelegramStatusCard } from "./TelegramStatusCard";

export function Dashboard() {
	const { botStatus, isLoading, isCancelling, refresh, cancelCurrentRun } =
		useBotStatus();

	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
				<header className="flex flex-col gap-2 rounded-2xl border bg-card/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-3">
						<Logo className="h-8 w-auto text-primary" />
						<div className="space-y-0.5">
							<h1 className="text-lg font-semibold tracking-wide">
								ADMIN DASHBOARD
							</h1>
							<p className="text-sm text-muted-foreground">
								Telegram status and settings.
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Shield className="h-3.5 w-3.5" />
						<span>Telegram</span>
						<Settings2 className="h-3.5 w-3.5" />
						<span>Config</span>
					</div>
				</header>

				<TelegramStatusCard
					status={botStatus}
					isLoading={isLoading}
					isCancelling={isCancelling}
					onRefresh={refresh}
					onCancel={cancelCurrentRun}
				/>

				<EnvEditor inline onSaved={refresh} />
			</div>
		</div>
	);
}
