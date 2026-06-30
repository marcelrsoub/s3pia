/**
 * CLI Commands
 *
 * Command-line interface for SepiaBot.
 * Provides status and gateway controls for the Telegram-first runtime.
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import { getAiProviders, getResolvedAiModelMetadata } from "../ai.js";
import {
	getAllEnvVarsWithMetadata,
	getEnvStatus,
	getEnvVar,
	setEnvVar,
	validateEnv,
} from "../env.js";
import { getGateway } from "../gateway/manager.js";

/**
 * Status command - show system status
 */
export async function statusCommand(): Promise<void> {
	console.log("[CLI] SepiaBot Status\n");

	// Configuration status
	const configStatus = getEnvStatus();
	console.log("Configuration:");
	console.log(`  Configured: ${configStatus.configured ? "✓" : "✗"}`);
	if (!configStatus.configured) {
		console.log(`  Missing: ${configStatus.missingRequired.join(", ")}`);
	}
	console.log("");

	// AI status
	const aiModel = getEnvVar("AI_MODEL") || "(auto)";
	const providers = getAiProviders();
	const metadata = getResolvedAiModelMetadata(
		getEnvVar("AI_MODEL") || undefined,
	);
	const activeProvider = metadata?.provider
		? metadata.provider
		: providers["openai-codex"].configured
			? "openai-codex"
			: providers.openrouter.configured
				? "openrouter"
				: "unconfigured";
	console.log("AI Backend:");
	console.log(`  Provider: ${activeProvider}`);
	console.log(`  Model: ${aiModel}`);
	console.log(
		`  OpenRouter: ${providers.openrouter.configured ? "connected" : "not connected"}`,
	);
	console.log(
		`  ChatGPT Plus: ${providers["openai-codex"].configured ? "connected" : "not connected"}`,
	);
	if (metadata) {
		console.log(
			`  Context: ${metadata.contextWindow?.toLocaleString() || "unknown"} tokens`,
		);
		console.log(
			`  Max completion: ${metadata.maxTokens?.toLocaleString() || "unknown"} tokens`,
		);
	}
	console.log("");

	// Gateway status (if running)
	const gateway = getGateway();
	if (gateway.isRunning()) {
		console.log("Gateway Status:");
		const telegramStatus = gateway.getStatus().telegram ?? {
			name: "telegram",
			enabled: false,
			running: false,
		};
		const running = telegramStatus.running ? "✓" : "✗";
		console.log(
			`  telegram: ${running} ${telegramStatus.enabled ? "enabled" : "disabled"}`,
		);
	} else {
		console.log("Gateway: Not running");
	}
}

/**
 * Config command - manage settings
 */
export async function configCommand(
	action: string | undefined,
	key?: string,
	value?: string,
): Promise<void> {
	if (!action) {
		console.log("Usage: config <get|set|validate> [key] [value]");
		return;
	}

	switch (action) {
		case "get": {
			if (key) {
				const val = getEnvVar(key);
				console.log(`${key} = ${val || "(not set)"}`);
			} else {
				const all = await getAllEnvVarsWithMetadata();
				console.log("Configuration:");
				for (const item of all) {
					const display = item.isSecret ? "***" : item.value;
					console.log(`  ${item.key} = ${display}`);
				}
			}
			break;
		}
		case "set": {
			if (!key || !value) {
				console.log("Usage: config set <key> <value>");
				return;
			}
			await setEnvVar(key, value);
			console.log(`Set ${key} = ${value}`);
			break;
		}
		case "validate": {
			const validation = validateEnv();
			if (validation.valid) {
				console.log("✓ Configuration is valid");
			} else {
				console.log("✗ Configuration errors:");
				for (const error of validation.errors) {
					console.log(`  - ${error}`);
				}
			}
			break;
		}
		default:
			console.log("Usage: config <get|set|validate> [key] [value]");
	}
}

/**
 * Gateway command - control the gateway service
 */
export async function gatewayCommand(
	action: string | undefined,
): Promise<void> {
	const gateway = getGateway();

	if (!action) {
		console.log("Usage: gateway <start|stop|status|restart>");
		return;
	}

	switch (action) {
		case "start": {
			if (gateway.isRunning()) {
				console.log("Gateway is already running");
				return;
			}
			console.log("Starting gateway...");
			await gateway.start();
			console.log("Gateway started");
			break;
		}
		case "stop": {
			if (!gateway.isRunning()) {
				console.log("Gateway is not running");
				return;
			}
			console.log("Stopping gateway...");
			await gateway.stop();
			console.log("Gateway stopped");
			break;
		}
		case "status": {
			if (gateway.isRunning()) {
				console.log("Gateway is running");
				const telegramStatus = gateway.getStatus().telegram ?? {
					name: "telegram",
					enabled: false,
					running: false,
				};
				const running = telegramStatus.running ? "✓" : "✗";
				console.log(`  telegram: ${running}`);
			} else {
				console.log("Gateway is not running");
			}
			break;
		}
		case "restart": {
			console.log("Restarting Telegram channel...");
			await gateway.reinitializeTelegramChannel();
			console.log("Telegram channel restarted");
			break;
		}
		default:
			console.log("Usage: gateway <start|stop|status|restart>");
	}
}

/**
 * Parse CLI arguments and execute command
 */
export async function executeCli(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	switch (command) {
		case "status": {
			await statusCommand();
			break;
		}
		case "config": {
			const action = args[1];
			const key = args[2];
			const value = args[3];
			await configCommand(action, key, value);
			break;
		}
		case "gateway": {
			const action = args[1];
			await gatewayCommand(action);
			break;
		}
		default:
			console.log(`
SepiaBot CLI

Usage: bun run src/cli/index.ts <command> [args...]

Commands:
  status                Show system status
	  config <get|set|validate> [key] [value]  Manage configuration
	  gateway <start|stop|status|restart>  Control the Telegram gateway

Examples:
  bun run src/cli/index.ts status
  bun run src/cli/index.ts config get AI_MODEL
  bun run src/cli/index.ts gateway start
`);
	}
}
