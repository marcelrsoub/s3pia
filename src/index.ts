/**
 * SepiaBot Main Entry Point
 *
 * Default mode: Start HTTP server with gateway service
 * CLI mode: Run commands directly
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

// Setup global error handlers
process.on("uncaughtException", (err) => {
	console.error("[Uncaught Exception]:", err);
});
process.on("unhandledRejection", (reason) => {
	console.error("[Unhandled Rejection]:", reason);
});

// Load environment variables FIRST before any other imports
import { loadEnvFile, migrateSettingsFromDatabase } from "./env.js";

await migrateSettingsFromDatabase();
await loadEnvFile();

const { syncDefaultWorkspaceFiles } = await import("./workspace-sync.js");
await syncDefaultWorkspaceFiles();

// Now import modules that depend on env vars
const { conversationStore } = await import("./conversation.js");
const { getGateway, startGateway, stopGateway } = await import(
	"./gateway/manager.js"
);
const { startLiveRunCoordinator, stopLiveRunCoordinator } = await import(
	"./live-run.js"
);
const { startHeartbeat, stopHeartbeat } = await import("./heartbeat.js");
const { startServer } = await import("./server.js");
const { getEnvStatus } = await import("./env.js");

// Initialize subsystems
console.log("Starting SepiaBot...");

// Import for side effects (initialization on import)
import { getMemory } from "./memory.js";

getMemory();
console.log(" Memory store ready");

// biome-ignore lint/correctness/noUnusedImports: Import for side effects (initialization on import)
import { logger } from "./logging.js";

console.log(" Logging system ready");
console.log(" Environment variables loaded");

// Check whether an AI provider is connected
const envStatus = getEnvStatus();
if (!envStatus.configured) {
	console.log("\n SETUP REQUIRED");
	console.log(`   Missing: ${envStatus.missingRequired.join(", ")}`);
	console.log(`   Connect OpenRouter or sign in with ChatGPT Plus`);
} else {
	console.log(" Configuration loaded");
}

const server = startServer();
console.log(` HTTP server listening on port ${server.port}`);

// Start gateway service (Telegram channel)
async function startServices() {
	startLiveRunCoordinator();
	await startGateway();
	console.log(" Gateway service started");

	// Start heartbeat scheduler
	await startHeartbeat();
	console.log(" Heartbeat scheduler started");

	// Show channel status
	const gateway = getGateway();
	const channelStatus = gateway.getStatus();
	for (const [name, status] of Object.entries(channelStatus)) {
		if (status.enabled) {
			const running = status.running ? "✓" : " ";
			console.log(`  ${running}${name} channel`);
		}
	}

	console.log("\nGateway service running. Press Ctrl+C to stop.\n");
}

startServices().catch((err) => {
	console.error("Error starting services:", err);
});

// Graceful shutdown
const shutdown = async () => {
	console.log("\n Shutting down...");
	await stopHeartbeat();
	await stopGateway();
	await stopLiveRunCoordinator();
	conversationStore.shutdown();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
