/**
 * Gateway Service Entry Point
 *
 * Starts the SepiaBot gateway service with all enabled channels.
 * Run with: bun run src/gateway/index.ts
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import { getEnvStatus } from "../env.js";
import { startServer } from "../server.js";
import { getGateway, startGateway, stopGateway } from "./manager.js";

/**
 * Start the gateway service
 */
async function startGatewayService(): Promise<void> {
	console.log("🐈 SepiaBot Gateway Service\n");

	// Check configuration
	const configStatus = getEnvStatus();
	if (!configStatus.configured) {
		console.log("⚠️  SETUP REQUIRED");
		console.log(`   Missing: ${configStatus.missingRequired.join(", ")}`);
		console.log("   Please configure the bot first\n");
	}

	// Start HTTP server (for web UI)
	const server = startServer();
	console.log(`📡 HTTP server listening on http://localhost:${server.port}`);

	// Start gateway (channels)
	await startGateway();
	console.log("✓ Gateway service started\n");

	// Show channel status
	const gateway = getGateway();
	const channelStatus = gateway.getStatus();
	console.log("Channels:");
	for (const [name, status] of Object.entries(channelStatus)) {
		if (status.enabled) {
			const running = status.running ? "✓" : "✗";
			console.log(`  ${running} ${name}`);
		}
	}
	console.log("");

	// Handle graceful shutdown
	const shutdown = async () => {
		console.log("\n🛑 Shutting down gateway service...");
		await stopGateway();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Keep process running
	console.log("Gateway service is running. Press Ctrl+C to stop.\n");
}

// Start the service
startGatewayService().catch((err) => {
	console.error("Failed to start gateway service:", err);
	process.exit(1);
});
