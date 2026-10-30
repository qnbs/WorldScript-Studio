// @vitest-environment node
/**
 * Tests for services/ai/localModelStorageService.ts
 * QNBS-v3: Verifies on-disk model-cache estimation + clearing — bucket pattern matching, the
 * storage estimate math, engine/session release on clear, and graceful no-API fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const releaseAllWebLlmEngines = vi.fn();
const releaseAllOnnxSessions = vi.fn();

vi.mock('@domain/ai-core', () => ({
  releaseAllWebLlmEngines: () => releaseAllWebLlmEngines(),
  releaseAllOnnxSessions: () => releaseAllOnnxSessions(),
}));

vi.mock('../../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  clearLocalModels,
  estimateLocalModelStorage,
  LOCAL_MODEL_CACHE_PATTERNS,
} from '../../../services/ai/localModelStorageService';

const MB = 1_048_576;
const WORLD_SCRIPT_TRANSFORMERS_CACHE = 'worldscript-transformers-cache';
const ALL_CACHE_NAMES = [
  'webllm/model',
  'webllm/config',
  'webllm/wasm',
  'transformers-cache',
  'experimental_transformers-hash-cache',
  WORLD_SCRIPT_TRANSFORMERS_CACHE,
  'worldscript-logs-db', // not a model cache
  'workbox-precache', // not a model cache
];

function installCaches(names: string[], deleteImpl?: (name: string) => Promise<boolean>) {
  const state = new Set(names);
  const del = vi.fn(async (name: string) => {
    const deleted = await (deleteImpl?.(name) ?? Promise.resolve(true));
    if (deleted) state.delete(name);
    return deleted;
  });
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => [...state]),
    delete: del,
  });
  return del;
}

function installStorage(usage: number, quota: number) {
  vi.stubGlobal('navigator', {
    storage: { estimate: vi.fn(async () => ({ usage, quota })) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LOCAL_MODEL_CACHE_PATTERNS', () => {
  it('matches only the positively namespaced WorldScript Transformers bucket', () => {
    const matches = (n: string) => LOCAL_MODEL_CACHE_PATTERNS.some((re) => re.test(n));
    expect(matches(WORLD_SCRIPT_TRANSFORMERS_CACHE)).toBe(true);
    expect(matches('webllm/model')).toBe(false);
    expect(matches('webllm/config')).toBe(false);
    expect(matches('webllm/wasm')).toBe(false);
    expect(matches('transformers-cache')).toBe(false);
    expect(matches('experimental_transformers-hash-cache')).toBe(false);
    expect(matches('worldscript-logs-db')).toBe(false);
    expect(matches('workbox-precache')).toBe(false);
  });

  // QNBS-v3: regression for the false-positive substring match a review found in the previous /webllm|transformers/i regex.
  it('never matches an unrelated cache that merely contains a vendor substring', () => {
    const matches = (n: string) => LOCAL_MODEL_CACHE_PATTERNS.some((re) => re.test(n));
    expect(matches('other-transformers-assets')).toBe(false);
    expect(matches('some-webllm-other-app')).toBe(false);
    expect(matches('mlc-chat-config')).toBe(false);
    expect(matches('tvmjs')).toBe(false);
  });
});

describe('estimateLocalModelStorage', () => {
  it('reports unsupported when neither Cache API nor StorageManager exists', async () => {
    // Deterministic: explicitly assert the absence of both, not the runtime env defaults.
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('navigator', {}); // present, but no .storage.estimate
    const est = await estimateLocalModelStorage();
    expect(est.estimateAvailable).toBe(false);
    expect(est.quotaMb).toBeNull();
    expect(est.freeMb).toBeNull();
    expect(est.usagePercent).toBeNull();
    expect(est.modelCacheCount).toBe(0);
  });

  it('computes usage/quota/free/percent and counts only model cache buckets', async () => {
    installStorage(100 * MB, 1000 * MB);
    installCaches(ALL_CACHE_NAMES);

    const est = await estimateLocalModelStorage();
    expect(est.estimateAvailable).toBe(true);
    expect(est.usageMb).toBe(100);
    expect(est.quotaMb).toBe(1000);
    expect(est.freeMb).toBe(900);
    expect(est.usagePercent).toBe(10);
    // QNBS-v3: vendor names are not proof of app ownership; count only the dedicated namespace.
    expect(est.modelCacheCount).toBe(1);
  });

  it('reports estimate-unavailable (null sizes) when only the Cache API is present', async () => {
    vi.stubGlobal('navigator', {}); // no StorageManager → quota unknown
    installCaches([WORLD_SCRIPT_TRANSFORMERS_CACHE, 'transformers-cache']);
    const est = await estimateLocalModelStorage();
    expect(est.estimateAvailable).toBe(false);
    expect(est.quotaMb).toBeNull();
    expect(est.freeMb).toBeNull();
    expect(est.usagePercent).toBeNull();
    // …but the on-disk model cache is still counted, so Clear stays actionable.
    expect(est.modelCacheCount).toBe(1);
  });
});

describe('clearLocalModels', () => {
  it('releases engines + sessions and deletes only the positively owned bucket', async () => {
    const del = installCaches(ALL_CACHE_NAMES);

    const result = await clearLocalModels();

    expect(releaseAllWebLlmEngines).toHaveBeenCalledTimes(1);
    expect(releaseAllOnnxSessions).toHaveBeenCalledTimes(1);
    expect(result.clearedCaches).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(WORLD_SCRIPT_TRANSFORMERS_CACHE);
    // Vendor-global and unrelated buckets remain outside this app-owned deletion path.
    expect(del).not.toHaveBeenCalledWith('webllm/model');
    expect(del).not.toHaveBeenCalledWith('transformers-cache');
    expect(del).not.toHaveBeenCalledWith('experimental_transformers-hash-cache');
    expect(del).not.toHaveBeenCalledWith('worldscript-logs-db');
    const remaining = await caches.keys();
    expect(remaining).toContain('webllm/model');
    expect(remaining).toContain('transformers-cache');
    expect(remaining).toContain('experimental_transformers-hash-cache');
    expect(remaining).not.toContain(WORLD_SCRIPT_TRANSFORMERS_CACHE);
  });

  it('does not throw and counts only successful deletes when one bucket fails', async () => {
    installCaches(ALL_CACHE_NAMES, async (name) => {
      if (name === WORLD_SCRIPT_TRANSFORMERS_CACHE) throw new Error('boom');
      return true;
    });

    const result = await clearLocalModels();
    expect(result.clearedCaches).toBe(0);
  });

  it('is a no-op delete count when the Cache API is absent', async () => {
    // Deterministic: explicitly remove the Cache API rather than relying on env defaults.
    vi.stubGlobal('caches', undefined);
    const result = await clearLocalModels();
    expect(releaseAllWebLlmEngines).toHaveBeenCalledTimes(1);
    expect(result.clearedCaches).toBe(0);
  });
});
