import { getApiKey } from "./api-keys.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_MODEL_URL = "https://openrouter.ai/api/v1/model";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_CONTEXT_LENGTH = 32_768;
const DEFAULT_MAX_COMPLETION_TOKENS = 4_096;

export interface OpenRouterModelMetadata {
	id: string;
	canonicalSlug?: string;
	name: string;
	contextLength: number;
	providerContextLength: number;
	maxCompletionTokens: number;
	supportedParameters: string[];
	tokenizer?: string | null;
}

interface OpenRouterModelApiResponse {
	id: string;
	canonical_slug?: string;
	name?: string;
	context_length?: number;
	architecture?: {
		tokenizer?: string | null;
	};
	top_provider?: {
		context_length?: number;
		max_completion_tokens?: number;
	};
	supported_parameters?: string[];
}

function normalizeModel(
	model: OpenRouterModelApiResponse,
): OpenRouterModelMetadata {
	const contextLength = Math.max(
		1,
		model.context_length ??
			model.top_provider?.context_length ??
			DEFAULT_CONTEXT_LENGTH,
	);
	const providerContextLength = Math.max(
		1,
		model.top_provider?.context_length ?? contextLength,
	);
	const maxCompletionTokens = Math.max(
		1,
		model.top_provider?.max_completion_tokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
	);

	return {
		id: model.id,
		canonicalSlug: model.canonical_slug,
		name: model.name || model.id,
		contextLength,
		providerContextLength,
		maxCompletionTokens,
		supportedParameters: model.supported_parameters ?? [],
		tokenizer: model.architecture?.tokenizer ?? null,
	};
}

async function fetchWithTimeout(
	fetcher: typeof fetch,
	input: string,
	init: RequestInit,
	timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetcher(input, {
			...init,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeoutId);
	}
}

export interface ModelBudget {
	model: OpenRouterModelMetadata | null;
	effectiveContextTokens: number;
	outputReserveTokens: number;
	systemReserveTokens: number;
	toolReserveTokens: number;
	usableInputTokens: number;
}

export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

export function getFallbackModelMetadata(
	modelId = process.env.AI_MODEL || "openrouter/unknown",
): OpenRouterModelMetadata {
	return {
		id: modelId,
		name: modelId,
		contextLength: DEFAULT_CONTEXT_LENGTH,
		providerContextLength: DEFAULT_CONTEXT_LENGTH,
		maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
		supportedParameters: [],
		tokenizer: null,
	};
}

class OpenRouterModelRegistry {
	private byId = new Map<string, OpenRouterModelMetadata>();
	private lastRefreshedAt: number | null = null;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private loadingPromise: Promise<void> | null = null;

	async refresh(fetcher: typeof fetch = fetch): Promise<void> {
		if (this.loadingPromise) {
			return this.loadingPromise;
		}

		this.loadingPromise = (async () => {
			const apiKey = getApiKey("openrouter");
			if (!apiKey) {
				throw new Error("OPENROUTER_API_KEY not configured");
			}

			const response = await fetchWithTimeout(fetcher, OPENROUTER_MODELS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			});
			if (!response.ok) {
				throw new Error(
					`OpenRouter models request failed: ${response.status} ${response.statusText}`,
				);
			}

			const payload = (await response.json()) as {
				data?: OpenRouterModelApiResponse[];
			};
			const nextById = new Map<string, OpenRouterModelMetadata>();

			for (const item of payload.data ?? []) {
				if (!item.id) continue;
				const normalized = normalizeModel(item);
				nextById.set(normalized.id, normalized);
				if (normalized.canonicalSlug) {
					nextById.set(normalized.canonicalSlug, normalized);
				}
			}

			this.byId = nextById;
			this.lastRefreshedAt = Date.now();
		})().finally(() => {
			this.loadingPromise = null;
		});

		return this.loadingPromise;
	}

	async getModel(
		modelId: string,
		fetcher: typeof fetch = fetch,
	): Promise<OpenRouterModelMetadata | null> {
		if (!modelId) return null;
		const cached = this.byId.get(modelId);
		if (cached) return cached;

		try {
			await this.refresh(fetcher);
			const afterRefresh = this.byId.get(modelId);
			if (afterRefresh) return afterRefresh;
		} catch (err) {
			console.warn("[OpenRouter] Failed to refresh models before lookup:", err);
		}

		const apiKey = getApiKey("openrouter");
		if (!apiKey) return null;

		const response = await fetchWithTimeout(
			fetcher,
			`${OPENROUTER_MODEL_URL}/${modelId.replace(/^\/+/, "")}`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			},
		);
		if (!response.ok) {
			return null;
		}

		const payload = (await response.json()) as {
			data?: OpenRouterModelApiResponse;
		};
		if (!payload.data) return null;

		const normalized = normalizeModel(payload.data);
		this.byId.set(normalized.id, normalized);
		if (normalized.canonicalSlug) {
			this.byId.set(normalized.canonicalSlug, normalized);
		}
		return normalized;
	}

	startAutoRefresh(): void {
		if (this.refreshTimer) return;
		this.refreshTimer = setInterval(() => {
			this.refresh().catch((err) => {
				console.warn("[OpenRouter] Periodic refresh failed:", err);
			});
		}, REFRESH_INTERVAL_MS);
	}

	stopAutoRefresh(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	getAllModels(): OpenRouterModelMetadata[] {
		const unique = new Map<string, OpenRouterModelMetadata>();
		for (const model of this.byId.values()) {
			unique.set(model.id, model);
		}
		return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	getStatus(): {
		lastRefreshedAt: number | null;
		count: number;
	} {
		return {
			lastRefreshedAt: this.lastRefreshedAt,
			count: this.getAllModels().length,
		};
	}

	getCachedModel(modelId: string): OpenRouterModelMetadata | null {
		if (!modelId) return null;
		return this.byId.get(modelId) ?? null;
	}
}

const registry = new OpenRouterModelRegistry();

export function getOpenRouterModelRegistry(): OpenRouterModelRegistry {
	return registry;
}

export function getCachedActiveModelMetadata(): OpenRouterModelMetadata | null {
	const modelId = process.env.AI_MODEL || "";
	if (!modelId) return null;
	return registry.getCachedModel(modelId);
}

export async function getActiveModelMetadata(): Promise<OpenRouterModelMetadata | null> {
	const modelId = process.env.AI_MODEL || "";
	if (!modelId) return null;
	try {
		return await registry.getModel(modelId);
	} catch (err) {
		console.warn(`[OpenRouter] Failed to load metadata for ${modelId}:`, err);
		return null;
	}
}

function buildModelBudget(model: OpenRouterModelMetadata | null): ModelBudget {
	const resolvedModel = model || getFallbackModelMetadata();
	const effectiveContextTokens = Math.max(
		8_192,
		Math.min(resolvedModel.contextLength, resolvedModel.providerContextLength),
	);
	const outputReserveTokens = Math.min(
		resolvedModel.maxCompletionTokens,
		Math.max(2_048, Math.floor(effectiveContextTokens * 0.2)),
	);
	const systemReserveTokens = Math.max(
		2_048,
		Math.floor(effectiveContextTokens * 0.1),
	);
	const toolReserveTokens = Math.max(
		2_048,
		Math.floor(effectiveContextTokens * 0.15),
	);
	const usableInputTokens = Math.max(
		2_048,
		effectiveContextTokens -
			outputReserveTokens -
			systemReserveTokens -
			toolReserveTokens,
	);

	return {
		model: resolvedModel,
		effectiveContextTokens,
		outputReserveTokens,
		systemReserveTokens,
		toolReserveTokens,
		usableInputTokens,
	};
}

export function getCachedActiveModelBudget(): ModelBudget {
	return buildModelBudget(
		getCachedActiveModelMetadata() || getFallbackModelMetadata(),
	);
}

export async function getActiveModelBudget(): Promise<ModelBudget> {
	return buildModelBudget(
		(await getActiveModelMetadata()) || getFallbackModelMetadata(),
	);
}
