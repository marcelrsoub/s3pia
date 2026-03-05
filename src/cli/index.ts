/**
 * CLI Entry Point
 *
 * Command-line interface for SepiaBot.
 * Run with: bun run src/cli/index.ts <command> [args...]
 *
 * Inspired by nanobot: https://github.com/HKUDS/nanobot
 */

import { loadEnvFile } from "../env.js";
import { executeCli } from "./commands.js";

// Initialize and execute CLI
async function main() {
	// Load environment variables first
	await loadEnvFile();

	// Execute CLI command
	await executeCli();
}

main().catch((err) => {
	console.error("CLI Error:", err);
	process.exit(1);
});
