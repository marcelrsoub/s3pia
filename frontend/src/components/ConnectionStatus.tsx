import type { ConnectionStatus } from "@/hooks/useWebSocket";
import { Badge } from "./ui/badge";

interface ConnectionStatusProps {
	status: ConnectionStatus;
}

const statusConfig = {
	connected: {
		label: "ONLINE",
		className:
			"bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20",
		ledClass: "connected",
	},
	connecting: {
		label: "CONNECT",
		className:
			"bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border-yellow-500/20",
		ledClass: "connecting",
	},
	disconnected: {
		label: "OFFLINE",
		className:
			"bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20",
		ledClass: "disconnected",
	},
	not_configured: {
		label: "CONFIG",
		className:
			"bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 border-orange-500/20",
		ledClass: "not-configured",
	},
};

export function ConnectionStatusIndicator({ status }: ConnectionStatusProps) {
	const config = statusConfig[status];

	return (
		<div className="flex items-center gap-2">
			<span className={`led-indicator ${config.ledClass}`} />
			<Badge variant="outline" className={config.className}>
				{config.label}
			</Badge>
		</div>
	);
}
