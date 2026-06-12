import {
	createTelegramChannel,
	type TelegramChannel,
} from "../channels/telegram.js";

export class GatewayManager {
	private telegramChannel: TelegramChannel | null = null;
	private started = false;

	constructor() {
		this.telegramChannel = createTelegramChannel();
	}

	async start(): Promise<void> {
		if (this.started) return;
		if (this.telegramChannel) {
			await this.telegramChannel.start();
		}
		this.started = true;
	}

	async stop(): Promise<void> {
		if (this.telegramChannel) {
			await this.telegramChannel.stop();
		}
		this.started = false;
	}

	async reinitializeTelegramChannel(): Promise<boolean> {
		if (this.telegramChannel?.isRunning()) {
			await this.telegramChannel.stop();
		}

		this.telegramChannel = createTelegramChannel();
		if (!this.telegramChannel) {
			return false;
		}

		if (this.started) {
			await this.telegramChannel.start();
		}

		return true;
	}

	getTelegramChannel(): TelegramChannel | null {
		return this.telegramChannel;
	}

	getStatus(): Record<
		string,
		{ name: string; enabled: boolean; running: boolean }
	> {
		return {
			telegram: this.telegramChannel
				? this.telegramChannel.getStatus()
				: { name: "telegram", enabled: false, running: false },
		};
	}

	isRunning(): boolean {
		return this.started;
	}
}

let globalGateway: GatewayManager | null = null;

export function getGateway(): GatewayManager {
	if (!globalGateway) {
		globalGateway = new GatewayManager();
	}
	return globalGateway;
}

export async function startGateway(): Promise<void> {
	await getGateway().start();
}

export async function stopGateway(): Promise<void> {
	if (globalGateway) {
		await globalGateway.stop();
	}
}
