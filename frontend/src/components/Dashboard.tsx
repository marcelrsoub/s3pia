import { PauseCircle, RadioTower, RefreshCw, Settings2 } from "lucide-react";
import { useBotStatus } from "@/hooks/useBotStatus";
import { EnvEditor } from "./EnvEditor";
import { Logo } from "./Logo";
import { getStatusLabel, TelegramStatusCard } from "./TelegramStatusCard";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "./ui/accordion";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export function Dashboard() {
	const { botStatus, isLoading, isCancelling, refresh, cancelCurrentRun } =
		useBotStatus();

	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
				<header className="flex items-center px-1 pt-1">
					<Logo className="h-9 w-auto text-primary" />
				</header>

				<Card className="gap-0 overflow-hidden py-0">
					<Accordion
						type="multiple"
						defaultValue={["live-run"]}
						className="w-full"
					>
						<AccordionItem value="live-run" className="border-b-0">
							<div className="flex items-start justify-between gap-4 border-b px-6 py-5">
								<AccordionTrigger className="min-w-0 flex-1 py-0 pr-4 text-left hover:no-underline [&>svg]:mt-1">
									<div className="flex min-w-0 items-start gap-3">
										<RadioTower className="mt-0.5 h-5 w-5 shrink-0" />
										<div className="min-w-0 space-y-0.5">
											<div className="font-retro text-lg">LIVE RUN</div>
											<div className="text-sm text-muted-foreground">
												{getStatusLabel(botStatus, isLoading)}
											</div>
										</div>
									</div>
								</AccordionTrigger>

								<div className="flex shrink-0 items-center gap-2 pt-0.5">
									<Button
										variant="outline"
										size="sm"
										onClick={refresh}
										disabled={isLoading}
									>
										<RefreshCw className="h-4 w-4" />
										<span className="ml-2">Refresh</span>
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={cancelCurrentRun}
										disabled={!botStatus?.canCancel || isCancelling}
									>
										<PauseCircle className="h-4 w-4" />
										<span className="ml-2">
											{isCancelling ? "Cancelling" : "Cancel"}
										</span>
									</Button>
								</div>
							</div>

							<AccordionContent className="px-6 pt-6 pb-6">
								<TelegramStatusCard
									status={botStatus}
									isLoading={isLoading}
									isCancelling={isCancelling}
									onRefresh={refresh}
									onCancel={cancelCurrentRun}
									framed={false}
								/>
							</AccordionContent>
						</AccordionItem>

						<AccordionItem value="environment" className="border-b-0">
							<div className="flex items-start justify-between gap-4 border-b px-6 py-5">
								<AccordionTrigger className="min-w-0 flex-1 py-0 pr-4 text-left hover:no-underline [&>svg]:mt-1">
									<div className="flex min-w-0 items-start gap-3">
										<Settings2 className="mt-0.5 h-5 w-5 shrink-0" />
										<div className="min-w-0">
											<div className="font-retro text-lg">ENVIRONMENT</div>
										</div>
									</div>
								</AccordionTrigger>
							</div>

							<AccordionContent className="px-6 pt-6 pb-6">
								<EnvEditor inline framed={false} onSaved={refresh} />
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				</Card>
			</div>
		</div>
	);
}
