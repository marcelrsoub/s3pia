/**
 * API Key Management Module
 *
 * Dynamic service-based API key management with no hardcoded registry.
 * Tools declare which service keys they require, then access them via getApiKey().
 *
 * Key Features:
 * - No hardcoded service list - any key can be created
 * - Service names derived from key names (e.g., "openai" → "OPENAI_API_KEY")
 * - Hot-reload via single setAPIKey() interface
 * - Core Agent visibility through getConfiguredServices()
 */

import {
	deleteEnvVar,
	getAllEnvVars,
	getAllEnvVarsWithMetadata,
	getEnvVar,
	setEnvVar,
} from "./env.js";

/**
 * Convert service name to setting key
 * Service: "openai" → Setting Key: "OPENAI_API_KEY"
 * Service: "my_service" → Setting Key: "MY_SERVICE_API_KEY"
 */
export function serviceToSettingKey(serviceName: string): string {
	return `${serviceName.toUpperCase()}_API_KEY`;
}

/**
 * Extract service name from setting key
 * Setting Key: "OPENAI_API_KEY" → Service: "openai"
 * Setting Key: "TELEGRAM_BOT_TOKEN" → Service: "telegram"
 */
export function settingKeyToService(settingKey: string): string {
	// Handle _TOKEN suffix (e.g., TELEGRAM_BOT_TOKEN)
	if (settingKey.endsWith("_TOKEN")) {
		return settingKey.replace("_TOKEN", "").toLowerCase();
	}
	// Handle _API_KEY suffix (e.g., OPENAI_API_KEY)
	if (settingKey.endsWith("_API_KEY")) {
		return settingKey.replace("_API_KEY", "").toLowerCase();
	}
	// Fallback: just lowercase the key
	return settingKey.toLowerCase();
}

/**
 * Check if a setting key is an API key or token
 */
export function isApiKeySetting(settingKey: string): boolean {
	return settingKey.endsWith("_API_KEY") || settingKey.endsWith("_TOKEN");
}

/**
 * Get API key for a service by service name
 *
 * @param serviceName - Service name (e.g., "openai", "fal", "telegram")
 * @returns API key value or null if not configured
 *
 * @example
 * const openaiKey = getApiKey('openai');
 * if (!openaiKey) {
 *   throw new Error('OpenAI API key not configured');
 * }
 */
export function getApiKey(serviceName: string): string | null {
	const settingKey = serviceToSettingKey(serviceName);
	return getEnvVar(settingKey);
}

/**
 * Get a setting by its exact key name
 * Use this for non-API-key settings or special cases
 *
 * @param settingKey - The exact setting key (e.g., "TELEGRAM_BOT_TOKEN")
 * @returns Setting value or null if not configured
 */
export function getSetting(settingKey: string): string | null {
	return getEnvVar(settingKey);
}

/**
 * Set API key for a service
 * This is the ONLY interface for updating API keys - enables hot-reload
 *
 * When called, this:
 * 1. Updates the .env file and process.env
 * 2. Keys are immediately available via getApiKey()
 *
 * @param serviceName - Service name (e.g., "openai", "fal")
 * @param value - API key value
 *
 * @example
 * await setAPIKey('openai', 'sk-...');
 * // Key is immediately available - no restart needed
 */
export async function setAPIKey(
	serviceName: string,
	value: string,
): Promise<void> {
	const settingKey = serviceToSettingKey(serviceName);

	// Update .env file and process.env
	await setEnvVar(settingKey, value);

	console.log(
		`[ApiKeys] Set ${settingKey} (${serviceName}) - hot-reload enabled`,
	);
}

/**
 * Set a setting by its exact key name
 * Use this for non-API-key settings or special cases
 *
 * @param settingKey - The exact setting key (e.g., "TELEGRAM_BOT_TOKEN")
 * @param value - Setting value
 */
export async function setSetting(
	settingKey: string,
	value: string,
): Promise<void> {
	await setEnvVar(settingKey, value);

	console.log(`[ApiKeys] Set ${settingKey} - hot-reload enabled`);
}

/**
 * Delete an API key
 *
 * @param serviceName - Service name (e.g., "openai", "fal")
 */
export async function deleteAPIKey(serviceName: string): Promise<void> {
	const settingKey = serviceToSettingKey(serviceName);
	await deleteEnvVar(settingKey);

	console.log(`[ApiKeys] Deleted ${settingKey} (${serviceName})`);
}

/**
 * Get all configured service names (for Core Agent visibility)
 * Returns only the names, not the values - for system prompt generation
 *
 * @returns Array of configured service names (sorted)
 *
 * @example
 * const services = await getConfiguredServices();
 * // Returns: ["telegram", "zai", "openrouter", "tavily"]
 */
export async function getConfiguredServices(): Promise<string[]> {
	const allSettings = await getAllEnvVarsWithMetadata();
	const services: Set<string> = new Set();

	for (const item of allSettings) {
		if (isApiKeySetting(item.key) && item.value && item.value.trim() !== "") {
			const serviceName = settingKeyToService(item.key);
			services.add(serviceName);
		}
	}

	return Array.from(services).sort();
}

/**
 * Get all configured API key settings with their display names
 * Returns metadata for system prompt generation
 *
 * @returns Array of { displayName, settingKey, serviceName }
 */
export async function getConfiguredKeysDisplay(): Promise<
	Array<{
		displayName: string;
		settingKey: string;
		serviceName: string;
	}>
> {
	const allSettings = await getAllEnvVarsWithMetadata();
	const configured: Array<{
		displayName: string;
		settingKey: string;
		serviceName: string;
	}> = [];

	for (const item of allSettings) {
		if (isApiKeySetting(item.key) && item.value && item.value.trim() !== "") {
			const serviceName = settingKeyToService(item.key);
			// Create display name: "OpenAI API Key" from "OPENAI_API_KEY"
			const displayName = item.key
				.split("_")
				.map((word) => word.charAt(0) + word.slice(1).toLowerCase())
				.join(" ");

			configured.push({
				displayName,
				settingKey: item.key,
				serviceName,
			});
		}
	}

	return configured.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
}

/**
 * Check if a service key is configured
 *
 * @param serviceName - Service name to check
 * @returns true if the service key is configured and non-empty
 */
export function isServiceConfigured(serviceName: string): boolean {
	const value = getApiKey(serviceName);
	return !!(value && value.trim() !== "");
}

/**
 * Validate that required service keys are configured
 *
 * @param requiredServices - Array of service names that must be configured
 * @returns Object with validation status and missing services
 */
export function validateRequiredServices(requiredServices: string[]): {
	valid: boolean;
	missing: string[];
} {
	const missing: string[] = [];

	for (const serviceName of requiredServices) {
		if (!isServiceConfigured(serviceName)) {
			missing.push(serviceName);
		}
	}

	return {
		valid: missing.length === 0,
		missing,
	};
}

/**
 * Get all API key settings from the .env file
 * Includes values - use with caution
 *
 * @returns Record of setting key to value
 */
export async function getAllApiKeys(): Promise<Record<string, string>> {
	const allSettings = await getAllEnvVars();
	const apiKeys: Record<string, string> = {};

	for (const [key, value] of Object.entries(allSettings)) {
		if (isApiKeySetting(key)) {
			apiKeys[key] = value;
		}
	}

	return apiKeys;
}

// Make getApiKey available globally for tool modules
// This allows tools to call getApiKey() without importing
if (typeof global !== "undefined") {
	(global as any).getApiKey = getApiKey;
	(global as any).getSetting = getSetting;
}
