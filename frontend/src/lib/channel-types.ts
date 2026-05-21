export type ConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected"
	| "not_configured";

export interface FileAttachment {
	filename: string;
	path: string;
	size?: number;
	downloadUrl: string;
}
