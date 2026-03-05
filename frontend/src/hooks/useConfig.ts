import { useCallback, useEffect, useState } from "react";

// AI provider types
export type AIProvider =
	| "zai"
	| "openrouter"
	| "anthropic"
	| "openai"
	| "deepseek"
	| "groq"
	| "gemini";

// Types matching the backend API
export interface SystemStatus {
	configured: boolean;
	missingRequired: string[];
	canStart: boolean;
}

export interface ConfigKey {
	key: string;
	label: string;
	description: string;
	required: boolean;
	isSecret: boolean;
	defaultValue?: string;
	category: "telegram" | "ai" | "server";
	placeholder?: string;
	validation?: RegExp;
}

export interface ConfigSchema {
	[category: string]: ConfigKey[];
}

export interface SettingValue {
	key: string;
	value: string;
	is_secret: boolean;
}

export interface ValidationResult {
	valid: boolean;
	missing?: string[];
	invalid?: string[];
}

export interface UpdateConfigResult {
	success: boolean;
	message: string;
	configured: boolean;
	restartRequired?: boolean;
	errors?: string[];
}

export interface TestKeyResult {
	valid: boolean;
	message: string;
}

const API_BASE = "/api/config";

export function useConfig() {
	const [status, setStatus] = useState<SystemStatus | null>(null);
	const [settings, setSettings] = useState<Record<string, string>>({});
	const [schema, setSchema] = useState<ConfigSchema | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Fetch configuration status
	const fetchStatus = useCallback(async () => {
		try {
			const response = await fetch(`${API_BASE}/status`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = (await response.json()) as SystemStatus;
			setStatus(data);
			setError(null);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to fetch status";
			setError(message);
			console.error("[useConfig] fetchStatus error:", err);
		}
	}, []);

	// Fetch configuration schema
	const fetchSchema = useCallback(async () => {
		try {
			const response = await fetch(`${API_BASE}/schema`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = (await response.json()) as ConfigSchema;
			setSchema(data);
			setError(null);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to fetch schema";
			setError(message);
			console.error("[useConfig] fetchSchema error:", err);
		}
	}, []);

	// Fetch current settings
	const fetchSettings = useCallback(async () => {
		try {
			setIsLoading(true);
			const response = await fetch(API_BASE);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const items = (await response.json()) as SettingValue[];
			const settingsObj: Record<string, string> = {};
			for (const item of items) {
				settingsObj[item.key] = item.value;
			}
			setSettings(settingsObj);
			setError(null);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to fetch settings";
			setError(message);
			console.error("[useConfig] fetchSettings error:", err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	// Save settings
	const saveSettings = useCallback(
		async (values: Record<string, string>): Promise<UpdateConfigResult> => {
			setIsSaving(true);
			setError(null);

			try {
				const response = await fetch(API_BASE, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(values),
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				const data = (await response.json()) as UpdateConfigResult;

				// Update local state
				setSettings((prev) => ({ ...prev, ...values }));

				// Refresh status to check if system is now configured
				await fetchStatus();

				return data;
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Failed to save settings";
				setError(message);
				console.error("[useConfig] saveSettings error:", err);
				return {
					success: false,
					message,
					configured: false,
				};
			} finally {
				setIsSaving(false);
			}
		},
		[fetchStatus],
	);

	// Validate configuration without saving
	const validateConfig = useCallback(
		async (values: Record<string, string>): Promise<ValidationResult> => {
			try {
				const response = await fetch(`${API_BASE}/validate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(values),
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				const data = (await response.json()) as ValidationResult;
				return data;
			} catch (err) {
				console.error("[useConfig] validateConfig error:", err);
				return {
					valid: false,
					invalid: [err instanceof Error ? err.message : "Validation failed"],
				};
			}
		},
		[],
	);

	// Test Z.AI API key
	const testZAIKey = useCallback(
		async (apiKey: string): Promise<TestKeyResult> => {
			try {
				const response = await fetch(`${API_BASE}/test/zai`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ apiKey }),
				});

				if (!response.ok) {
					const error = await response
						.json()
						.catch(() => ({ error: "Test failed" }));
					throw new Error(error.error || "Test failed");
				}

				const data = (await response.json()) as TestKeyResult;
				return data;
			} catch (err) {
				console.error("[useConfig] testZAIKey error:", err);
				return {
					valid: false,
					message: err instanceof Error ? err.message : "Test failed",
				};
			}
		},
		[],
	);

	// Initialize on mount
	useEffect(() => {
		const init = async () => {
			setIsLoading(true);
			await Promise.all([fetchStatus(), fetchSchema(), fetchSettings()]);
			setIsLoading(false);
		};

		init();
	}, [fetchStatus, fetchSchema, fetchSettings]);

	return {
		status,
		settings,
		schema,
		isLoading,
		isSaving,
		error,
		fetchStatus,
		fetchSettings,
		saveSettings,
		validateConfig,
		testZAIKey,
	};
}
