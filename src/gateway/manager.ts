/**
 * Gateway Manager
 *
 * Manages lifecycle of all communication channels.
 * Routes messages between channels and the agent.
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import type { BaseChannel } from "../channels/base.js";
import {
	createTelegramChannel,
	type TelegramChannel,
} from "../channels/telegram.js";
import { createWebChannel, type WebChannel } from "../channels/web.js";

/**
 * Gateway configuration
 */
export interface GatewayConfig {
	telegram: {
		enabled: boolean;
	};
	web: {
		enabled: boolean;
	};
}

/**
 * Gateway Manager
 *
 * Manages all communication channels and their lifecycle.
 */
export class GatewayManager {
	private channels: Map<string, BaseChannel> = new Map();
	private started = false;

	constructor() {
		// Register channels
		this.registerChannels();
	}

	/**
	 * Register all available channels
	 */
	private registerChannels(): void {
		// Web channel (always enabled)
		const webChannel = createWebChannel();
		if (webChannel) {
			this.channels.set("web", webChannel);
		}

		// Telegram channel (if configured)
		const telegramChannel = createTelegramChannel();
		if (telegramChannel) {
			this.channels.set("telegram", telegramChannel);
		}
	}

	/**
	 * Start all enabled channels
	 */
	async start(): Promise<void> {
		if (this.started) {
			console.log("[Gateway] Already started");
			return;
		}

		console.log("[Gateway] Starting channels...");

		for (const [name, channel] of this.channels) {
			if (channel.getStatus().enabled) {
				console.log(`[Gateway] Starting ${name} channel...`);
				try {
					await channel.start();
					console.log(`[Gateway] ${name} channel started`);
				} catch (err) {
					console.error(`[Gateway] Failed to start ${name} channel:`, err);
				}
			}
		}

		this.started = true;
		console.log("[Gateway] All channels started");
	}

	/**
	 * Stop all channels
	 */
	async stop(): Promise<void> {
		console.log("[Gateway] Stopping channels...");

		for (const [name, channel] of this.channels) {
			if (channel.isRunning()) {
				console.log(`[Gateway] Stopping ${name} channel...`);
				try {
					await channel.stop();
					console.log(`[Gateway] ${name} channel stopped`);
				} catch (err) {
					console.error(`[Gateway] Failed to stop ${name} channel:`, err);
				}
			}
		}

		this.started = false;
		console.log("[Gateway] All channels stopped");
	}

	/**
	 * Restart a specific channel
	 */
	async restartChannel(name: string): Promise<void> {
		const channel = this.channels.get(name);
		if (!channel) {
			console.error(`[Gateway] Channel ${name} not found`);
			return;
		}

		console.log(`[Gateway] Restarting ${name} channel...`);
		await channel.stop();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await channel.start();
		console.log(`[Gateway] ${name} channel restarted`);
	}

	/**
	 * Recreate and start Telegram channel after config change
	 * Handles case where channel didn't exist at startup
	 */
	async reinitializeTelegramChannel(): Promise<boolean> {
		const existingChannel = this.channels.get("telegram");

		if (existingChannel) {
			if (existingChannel.isRunning()) {
				await existingChannel.stop();
			}
			this.channels.delete("telegram");
		}

		const newChannel = createTelegramChannel();
		if (!newChannel) {
			console.log("[Gateway] Telegram channel not configured");
			return false;
		}

		this.channels.set("telegram", newChannel);

		if (this.started) {
			console.log("[Gateway] Starting newly configured Telegram channel...");
			try {
				await newChannel.start();
				console.log("[Gateway] Telegram channel started");
				return true;
			} catch (err) {
				console.error("[Gateway] Failed to start Telegram channel:", err);
				return false;
			}
		}

		return true;
	}

	/**
	 * Get a specific channel
	 */
	getChannel(name: string): BaseChannel | undefined {
		return this.channels.get(name);
	}

	/**
	 * Get web channel
	 */
	getWebChannel(): WebChannel | undefined {
		return this.getChannel("web") as WebChannel | undefined;
	}

	/**
	 * Get telegram channel
	 */
	getTelegramChannel(): TelegramChannel | undefined {
		return this.getChannel("telegram") as TelegramChannel | undefined;
	}

	/**
	 * Get status of all channels
	 */
	getStatus(): Record<
		string,
		{ name: string; enabled: boolean; running: boolean }
	> {
		const status: Record<
			string,
			{ name: string; enabled: boolean; running: boolean }
		> = {};

		for (const [name, channel] of this.channels) {
			status[name] = channel.getStatus();
		}

		return status;
	}

	/**
	 * Check if gateway is running
	 */
	isRunning(): boolean {
		return this.started;
	}
}

/**
 * Global gateway manager instance
 */
let globalGateway: GatewayManager | null = null;

/**
 * Get or create global gateway instance
 */
export function getGateway(): GatewayManager {
	if (!globalGateway) {
		globalGateway = new GatewayManager();
	}
	return globalGateway;
}

/**
 * Start the gateway
 */
export async function startGateway(): Promise<void> {
	const gateway = getGateway();
	await gateway.start();
}

/**
 * Stop the gateway
 */
export async function stopGateway(): Promise<void> {
	if (globalGateway) {
		await globalGateway.stop();
	}
}
