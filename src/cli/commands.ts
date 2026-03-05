/**
 * CLI Commands
 *
 * Command-line interface for SepiaBot.
 * Provides direct interaction with the agent without running the full gateway.
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import { Agent } from "../agent.js";
import {
	getAllEnvVarsWithMetadata,
	getEnvStatus,
	getEnvVar,
	setEnvVar,
	validateEnv,
} from "../env.js";
import { getGateway } from "../gateway/manager.js";
import {
	getAllProviderNames,
	getProviderByName,
} from "../providers/registry.js";

/**
 * Agent command - interact with the agent directly
 */
export async function agentCommand(message: string): Promise<void> {
	console.log(`[CLI] Processing: "${message}"`);

	const agent = new Agent();
	const result = await agent.execute(message);

	if (result.blocked) {
		console.log(`[CLI] Blocked: ${result.question}`);
		return;
	}

	if (result.incomplete) {
		console.log(`[CLI] Incomplete (max iterations reached)`);
	}

	console.log(`[CLI] Result:\n${result.result}`);
	console.log(
		`\n[CLI] Iterations: ${result.iterations}, Duration: ${result.duration}ms`,
	);
}

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

	// Provider status
	const aiProvider = getEnvVar("AI_PROVIDER") || "zai";
	const aiModel = getEnvVar("AI_MODEL") || "unknown";
	console.log("AI Provider:");
	console.log(`  Provider: ${aiProvider}`);
	console.log(`  Model: ${aiModel}`);

	const provider = getProviderByName(aiProvider);
	if (provider) {
		console.log(`  Base URL: ${provider.baseURL}`);
	}
	console.log("");

	// Available providers
	console.log(`Available Providers: ${getAllProviderNames().join(", ")}`);
	console.log("");

	// Gateway status (if running)
	const gateway = getGateway();
	if (gateway.isRunning()) {
		console.log("Gateway Status:");
		const channelStatus = gateway.getStatus();
		for (const [name, status] of Object.entries(channelStatus)) {
			const running = status.running ? "✓" : "✗";
			console.log(
				`  ${name}: ${running} ${status.enabled ? "enabled" : "disabled"}`,
			);
		}
	} else {
		console.log("Gateway: Not running");
	}
}

/**
 * Config command - manage settings
 */
export async function configCommand(
	action: string,
	key?: string,
	value?: string,
): Promise<void> {
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
export async function gatewayCommand(action: string): Promise<void> {
	const gateway = getGateway();

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
				const channelStatus = gateway.getStatus();
				for (const [name, status] of Object.entries(channelStatus)) {
					const running = status.running ? "✓" : "✗";
					console.log(`  ${name}: ${running}`);
				}
			} else {
				console.log("Gateway is not running");
			}
			break;
		}
		case "restart": {
			const channel = process.argv[4]; // Optional channel name
			if (channel) {
				console.log(`Restarting ${channel} channel...`);
				await gateway.restartChannel(channel);
				console.log(`${channel} channel restarted`);
			} else {
				console.log("Restarting all channels...");
				await gateway.stop();
				await gateway.start();
				console.log("All channels restarted");
			}
			break;
		}
		default:
			console.log("Usage: gateway <start|stop|status|restart> [channel]");
	}
}

/**
 * Parse CLI arguments and execute command
 */
export async function executeCli(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	switch (command) {
		case "agent": {
			const message = args[1];
			if (!message) {
				console.log("Usage: agent <message>");
				return;
			}
			await agentCommand(message);
			break;
		}
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
		case "help":
		default:
			console.log(`
SepiaBot CLI

Usage: bun run src/cli/index.ts <command> [args...]

Commands:
  agent <message>       Send a message to the agent
  status                Show system status
  config <get|set|validate> [key] [value]  Manage configuration
  gateway <start|stop|status|restart> [channel]  Control gateway

Examples:
  bun run src/cli/index.ts agent "What is 2+2?"
  bun run src/cli/index.ts status
  bun run src/cli/index.ts config get AI_PROVIDER
  bun run src/cli/index.ts gateway start
`);
	}
}
