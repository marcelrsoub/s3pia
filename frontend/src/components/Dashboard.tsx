import { Shield, Settings2 } from "lucide-react";
import { EnvEditor } from "./EnvEditor";
import { Logo } from "./Logo";
import { TelegramStatusCard } from "./TelegramStatusCard";
import { useBotStatus } from "@/hooks/useBotStatus";
import { Badge } from "./ui/badge";

export function Dashboard() {
	const { botStatus, isLoading, refresh } = useBotStatus();

	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
				<header className="flex flex-col gap-3 rounded-2xl border bg-card/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-3">
						<Logo className="h-8 w-auto text-primary" />
						<div>
							<h1 className="text-lg font-semibold tracking-wide">
								ADMIN DASHBOARD
							</h1>
							<p className="text-sm text-muted-foreground">
								Telegram is the only interaction channel. This page is for
								status and configuration.
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant="outline" className="gap-2">
							<Shield className="h-3.5 w-3.5" />
							Telegram only
						</Badge>
						<Badge variant="outline" className="gap-2">
							<Settings2 className="h-3.5 w-3.5" />
							Admin config
						</Badge>
					</div>
				</header>

				<TelegramStatusCard
					status={botStatus}
					isLoading={isLoading}
					onRefresh={refresh}
				/>

				<EnvEditor inline onSaved={refresh} />
			</div>
		</div>
	);
}
