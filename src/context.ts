let currentSourceChannel: "web" | "telegram" = "web";

export function setSourceChannel(channel: "web" | "telegram"): void {
	currentSourceChannel = channel;
}

export function getSourceChannel(): "web" | "telegram" {
	return currentSourceChannel;
}
