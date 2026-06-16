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
const ALL_CACHE_NAMES = [
  'webllm/model',
  'webllm/wasm',
  'transformers-cache',
  'worldscript-logs-db', // not a model cache
  'workbox-precache', // not a model cache
];

function installCaches(names: string[], deleteImpl?: (name: string) => Promise<boolean>) {
  const del = vi.fn(deleteImpl ?? (async () => true));
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => names),
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
  it('matches WebLLM/MLC/tvmjs/transformers buckets and nothing else', () => {
    const matches = (n: string) => LOCAL_MODEL_CACHE_PATTERNS.some((re) => re.test(n));
    expect(matches('webllm/model')).toBe(true);
    expect(matches('mlc-chat-config')).toBe(true);
    expect(matches('tvmjs')).toBe(true);
    expect(matches('transformers-cache')).toBe(true);
    expect(matches('worldscript-logs-db')).toBe(false);
    expect(matches('workbox-precache')).toBe(false);
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
    // webllm/model, webllm/wasm, transformers-cache → 3 (the two non-model buckets excluded)
    expect(est.modelCacheCount).toBe(3);
  });

  it('reports estimate-unavailable (null sizes) when only the Cache API is present', async () => {
    vi.stubGlobal('navigator', {}); // no StorageManager → quota unknown
    installCaches(['webllm/model']);
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
  it('releases engines + sessions and deletes every matching bucket', async () => {
    const del = installCaches(ALL_CACHE_NAMES);

    const result = await clearLocalModels();

    expect(releaseAllWebLlmEngines).toHaveBeenCalledTimes(1);
    expect(releaseAllOnnxSessions).toHaveBeenCalledTimes(1);
    expect(result.clearedCaches).toBe(3);
    expect(del).toHaveBeenCalledWith('webllm/model');
    expect(del).toHaveBeenCalledWith('transformers-cache');
    // Non-model buckets are never deleted.
    expect(del).not.toHaveBeenCalledWith('worldscript-logs-db');
  });

  it('does not throw and counts only successful deletes when one bucket fails', async () => {
    installCaches(ALL_CACHE_NAMES, async (name) => {
      if (name === 'webllm/wasm') throw new Error('boom');
      return true;
    });

    const result = await clearLocalModels();
    // webllm/model + transformers-cache succeeded; webllm/wasm threw.
    expect(result.clearedCaches).toBe(2);
  });

  it('is a no-op delete count when the Cache API is absent', async () => {
    // Deterministic: explicitly remove the Cache API rather than relying on env defaults.
    vi.stubGlobal('caches', undefined);
    const result = await clearLocalModels();
    expect(releaseAllWebLlmEngines).toHaveBeenCalledTimes(1);
    expect(result.clearedCaches).toBe(0);
  });
});
