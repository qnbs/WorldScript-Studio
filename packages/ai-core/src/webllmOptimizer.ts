/**
 * webllmOptimizer — Cached WebLLM engine with pre-warming, power preference tuning,
 * and explicit disposal for memory-pressure handling.
 * QNBS-v3: Extracted from index.ts to keep engine lifecycle separate from inference calls.
 */

import type { WebLlmModelId } from './index';

interface MLCEngine {
  chat: {
    completions: {
      create: (req: {
        messages: { role: string; content: string }[];
        max_tokens?: number;
        temperature?: number;
      }) => Promise<{ choices: { message?: { content?: string } }[] }>;
    };
  };
  // QNBS-v3: dispose() releases GPU buffers and model weights — always call on cache eviction
  dispose?: () => Promise<void>;
}

interface MLCModule {
  CreateMLCEngine?: (
    model: string,
    init?: {
      initProgressCallback?: (p: unknown) => void;
      appConfig?: { model_list: Array<{ model_id: string; model_lib: string }> };
    },
  ) => Promise<MLCEngine>;
}

type PowerPreference = 'low-power' | 'high-performance';

interface EngineCacheEntry {
  modelId: string;
  engine: MLCEngine;
  createdAt: number;
  lastUsedAt: number;
  powerPreference: PowerPreference;
}

const engineCache = new Map<string, EngineCacheEntry>();
const MAX_CACHED_ENGINES = 2;

function getCacheKey(modelId: string, powerPreference: PowerPreference): string {
  return `${modelId}::${powerPreference}`;
}

/**
 * Create or retrieve a cached WebLLM engine.
 * QNBS-v3: Engines are cached by (modelId, powerPreference) to avoid re-initialization.
 */
export async function getWebLlmEngine(
  modelId: WebLlmModelId,
  opts: {
    onProgress?: (report: { progress: number; text: string }) => void;
    powerPreference?: PowerPreference;
  } = {},
): Promise<MLCEngine | null> {
  const powerPreference = opts.powerPreference ?? 'high-performance';
  const cacheKey = getCacheKey(modelId, powerPreference);

  const cached = engineCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.engine;
  }

  // Evict oldest if at capacity
  if (engineCache.size >= MAX_CACHED_ENGINES) {
    let oldestKey = '';
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, entry] of engineCache) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      // QNBS-v3: dispose() releases GPU memory before evicting from cache
      const evicted = engineCache.get(oldestKey);
      engineCache.delete(oldestKey);
      if (evicted) {
        void evicted.engine.dispose?.().catch(() => {});
      }
    }
  }

  try {
    const mod = (await import('./vendor-webllm')) as unknown as MLCModule;
    const CreateMLCEngine = mod.CreateMLCEngine;
    if (typeof CreateMLCEngine !== 'function') {
      return null;
    }

    const engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (p: unknown) => {
        if (opts.onProgress && typeof p === 'object' && p !== null) {
          const r = p as { progress?: number; text?: string };
          opts.onProgress({ progress: r.progress ?? 0, text: r.text ?? '' });
        }
      },
    });

    engineCache.set(cacheKey, {
      modelId,
      engine,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      powerPreference,
    });

    return engine;
  } catch {
    return null;
  }
}

/**
 * Pre-warm a WebLLM engine (load model weights into memory before user action).
 * QNBS-v3: Call during idle time or when user opens a feature that will need inference.
 */
export async function prewarmWebLlm(
  modelId: WebLlmModelId,
  powerPreference: PowerPreference = 'high-performance',
): Promise<boolean> {
  const engine = await getWebLlmEngine(modelId, { powerPreference });
  return engine !== null;
}

/**
 * Release a cached WebLLM engine to free GPU memory.
 * QNBS-v3: When powerPreference is omitted, BOTH cache variants are released to avoid leaking
 *          the non-default variant when the caller doesn't know which preference was used.
 */
export function releaseWebLlm(modelId: WebLlmModelId, powerPreference?: PowerPreference): void {
  if (powerPreference !== undefined) {
    const key = getCacheKey(modelId, powerPreference);
    const entry = engineCache.get(key);
    engineCache.delete(key);
    if (entry) void entry.engine.dispose?.().catch(() => {});
  } else {
    // QNBS-v3: delete both variants when powerPreference is unknown
    for (const variant of ['high-performance', 'low-power'] as PowerPreference[]) {
      const key = getCacheKey(modelId, variant);
      const entry = engineCache.get(key);
      engineCache.delete(key);
      if (entry) void entry.engine.dispose?.().catch(() => {});
    }
  }
}

/**
 * Release ALL cached WebLLM engines (emergency memory pressure handler).
 */
export function releaseAllWebLlmEngines(): void {
  for (const entry of engineCache.values()) {
    void entry.engine.dispose?.().catch(() => {});
  }
  engineCache.clear();
}

/**
 * List currently cached engines (for telemetry / debugging).
 */
export function listCachedWebLlmEngines(): Array<{
  modelId: string;
  powerPreference: PowerPreference;
  createdAt: number;
  lastUsedAt: number;
}> {
  return Array.from(engineCache.values()).map((e) => ({
    modelId: e.modelId,
    powerPreference: e.powerPreference,
    createdAt: e.createdAt,
    lastUsedAt: e.lastUsedAt,
  }));
}

/**
 * Run text generation through a cached WebLLM engine.
 * QNBS-v3: Thin wrapper over getWebLlmEngine + chat.completions.create.
 */
export async function runWebLlmInference(
  modelId: WebLlmModelId,
  prompt: string,
  opts: {
    maxTokens?: number;
    temperature?: number;
    onProgress?: (report: { progress: number; text: string }) => void;
    powerPreference?: PowerPreference;
  } = {},
): Promise<string | null> {
  // QNBS-v3: exactOptionalPropertyTypes — only include optional properties when they are defined
  const engineOpts: {
    onProgress?: (report: { progress: number; text: string }) => void;
    powerPreference?: PowerPreference;
  } = {};
  if (opts.onProgress !== undefined) engineOpts.onProgress = opts.onProgress;
  if (opts.powerPreference !== undefined) engineOpts.powerPreference = opts.powerPreference;
  const engine = await getWebLlmEngine(modelId, engineOpts);
  if (!engine) return null;

  const reply = await engine.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts.maxTokens ?? 256,
    temperature: opts.temperature ?? 0.7,
  });

  return reply.choices[0]?.message?.content?.trim() ?? null;
}
