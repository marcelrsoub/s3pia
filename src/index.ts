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
const { startHeartbeat, stopHeartbeat } = await import("./heartbeat.js");
const { getOpenRouterModelRegistry } = await import("./openrouter.js");
const { startServer } = await import("./server.js");
const { startTaskQueue, stopTaskQueue } = await import("./task-queue.js");

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

// Check required env vars
const requiredEnvVars = ["OPENROUTER_API_KEY", "AI_MODEL"];
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
const legacyProviderKeys = [
	"AI_PROVIDER",
	"ZAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"DEEPSEEK_API_KEY",
	"GROQ_API_KEY",
	"GEMINI_API_KEY",
];
const legacyConfigured = legacyProviderKeys.filter((key) => process.env[key]);

if (missingVars.length > 0) {
	console.log("\n SETUP REQUIRED");
	console.log(`   Missing: ${missingVars.join(", ")}`);
	if (legacyConfigured.length > 0) {
		console.log("   Direct providers are deprecated.");
		console.log("   Configure OPENROUTER_API_KEY and AI_MODEL instead.");
	}
	console.log(`   Add to /app/ws/config/.env and restart`);
} else {
	console.log(" Configuration loaded");
}

const server = startServer();
console.log(` HTTP server listening on port ${server.port}`);

// Start gateway service (Telegram, Web channels)
async function startServices() {
	startTaskQueue();
	await startGateway();
	console.log(" Gateway service started");

	const registry = getOpenRouterModelRegistry();
	registry.startAutoRefresh();
	void registry
		.refresh()
		.then(() => {
			console.log(
				` OpenRouter metadata ready (${registry.getStatus().count} models cached)`,
			);
		})
		.catch((err) => {
			console.warn(" OpenRouter metadata unavailable:", err);
		});

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
	getOpenRouterModelRegistry().stopAutoRefresh();
	await stopHeartbeat();
	await stopGateway();
	stopTaskQueue();
	conversationStore.shutdown();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
