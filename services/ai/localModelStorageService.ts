// QNBS-v3: on-disk local-model cache management — @domain/ai-core's release fns only free in-memory GPU/WASM handles, so this service estimates/clears the multi-GB downloaded weights that persist in the Cache API.

import {
  releaseAllOnnxSessions,
  releaseAllWebLlmEngines,
  WEBLLM_MODEL_APPROX_MB,
} from '@domain/ai-core';
import { logger } from '../logger';

// QNBS-v3: exact vendor CacheStorage bucket names, not a substring match — narrows the false-positive foreign-cache matches a loose regex had, but these names are still vendor-fixed, not app-scoped, so this is not a full positive-ownership proof (tracked separately).
export const LOCAL_MODEL_CACHE_PATTERNS: readonly RegExp[] = [
  /^webllm\/model$/,
  /^webllm\/config$/,
  /^webllm\/wasm$/,
  /^transformers-cache$/,
  /^experimental_transformers-hash-cache$/,
];

// QNBS-v3: re-export the canonical @domain/ai-core table instead of maintaining a second, driftable literal.
export { WEBLLM_MODEL_APPROX_MB };

export interface LocalModelStorageEstimate {
  // QNBS-v3: null when the StorageManager quota is unknown — callers MUST NOT treat that as "0 free",
  //          which would falsely warn every model as too large on browsers without storage.estimate().
  usageMb: number | null;
  quotaMb: number | null;
  freeMb: number | null;
  usagePercent: number | null;
  modelCacheCount: number;
  /** True only when the StorageManager returned a usable quota; sizes are non-null iff this is true. */
  estimateAvailable: boolean;
}

export interface ClearLocalModelsResult {
  clearedCaches: number;
}

function hasCacheApi(): boolean {
  return typeof caches !== 'undefined' && typeof caches.keys === 'function';
}

function hasStorageEstimate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.estimate === 'function';
}

function isModelCacheName(name: string): boolean {
  return LOCAL_MODEL_CACHE_PATTERNS.some((re) => re.test(name));
}

async function listModelCacheNames(): Promise<string[]> {
  if (!hasCacheApi()) return [];
  try {
    const keys = await caches.keys();
    return keys.filter(isModelCacheName);
  } catch (err) {
    logger.warn('localModelStorage: caches.keys() failed', { err: String(err) });
    return [];
  }
}

/**
 * QNBS-v3: Estimate total persistent storage usage + how many local-model cache buckets exist.
 * Exact per-cache byte sizes are not exposed by the platform, so `usageMb` is the whole-origin
 * estimate (the dominant contributor is the model weights) and `modelCacheCount` proves models exist.
 */
export async function estimateLocalModelStorage(): Promise<LocalModelStorageEstimate> {
  const modelCacheCount = (await listModelCacheNames()).length;

  let usageMb: number | null = null;
  let quotaMb: number | null = null;
  if (hasStorageEstimate()) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (typeof usage === 'number') usageMb = Math.round(usage / 1_048_576);
      if (typeof quota === 'number') quotaMb = Math.round(quota / 1_048_576);
    } catch (err) {
      logger.warn('localModelStorage: storage.estimate() failed', { err: String(err) });
    }
  }

  // QNBS-v3: free/percent are only meaningful with a real quota AND usage — otherwise stay null so
  //          the UI shows "estimate unavailable" instead of a misleading 0 (which warns on every model).
  let freeMb: number | null = null;
  let usagePercent: number | null = null;
  if (quotaMb !== null && quotaMb > 0 && usageMb !== null) {
    freeMb = Math.max(0, quotaMb - usageMb);
    usagePercent = Math.round((usageMb / quotaMb) * 100);
  }

  return {
    usageMb,
    quotaMb,
    freeMb,
    usagePercent,
    modelCacheCount,
    estimateAvailable: freeMb !== null,
  };
}

/**
 * QNBS-v3: Free downloaded local-model weights. Releases in-memory engine/session handles FIRST so
 * no live reference pins the buffers, then deletes every matching Cache API bucket. Never throws —
 * partial failures are logged and the deleted count is returned so the UI can report honestly.
 */
export async function clearLocalModels(): Promise<ClearLocalModelsResult> {
  try {
    releaseAllWebLlmEngines();
  } catch (err) {
    logger.warn('localModelStorage: releaseAllWebLlmEngines failed', { err: String(err) });
  }
  try {
    // QNBS-v3: releaseAllOnnxSessions is async — await so failures hit this catch and session
    //          release fully completes before we start deleting the on-disk caches.
    await releaseAllOnnxSessions();
  } catch (err) {
    logger.warn('localModelStorage: releaseAllOnnxSessions failed', { err: String(err) });
  }

  const names = await listModelCacheNames();
  let clearedCaches = 0;
  for (const name of names) {
    try {
      const deleted = await caches.delete(name);
      if (deleted) clearedCaches += 1;
    } catch (err) {
      logger.warn('localModelStorage: caches.delete failed', { cache: name, err: String(err) });
    }
  }

  logger.info('localModelStorage: cleared local model caches', {
    clearedCaches,
    requested: names.length,
  });
  return { clearedCaches };
}
