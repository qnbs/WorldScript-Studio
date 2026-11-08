/**
 * Tests for services/ai/localModelStorageService.ts
 * QNBS-v3: Verifies on-disk model-cache estimation + clearing — bucket pattern matching, the
 * storage estimate math, engine/session release on clear, and graceful no-API fallback.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const releaseAllWebLlmEngines = vi.fn();
const releaseAllOnnxSessions = vi.fn();
const componentMocks = vi.hoisted(() => ({
  announce: vi.fn(),
  detectWebGpu: vi.fn(() => true),
  healthReport: vi.fn(async () => ({ deviceClass: 'mid-range', gpuVramTier: 'medium' })),
  modelRec: vi.fn(() => 'm-small'),
  getReady: vi.fn(() => ['m-small']),
  clearReady: vi.fn(),
  abortPreload: vi.fn(),
  busy: vi.fn(() => false),
}));

vi.mock('@domain/ai-core', () => ({
  releaseAllWebLlmEngines: () => releaseAllWebLlmEngines(),
  releaseAllOnnxSessions: () => releaseAllOnnxSessions(),
  detectWebGpuSupport: () => componentMocks.detectWebGpu(),
  WEBLLM_SUPPORTED_MODELS: [
    { id: 'm-small', label: 'Small (~0.4 GB)' },
    { id: 'm-big', label: 'Big (~5 GB)' },
  ],
  WEBLLM_MODEL_APPROX_MB: { 'm-small': 400, 'm-big': 5000 },
  preloadLocalModel: vi.fn(),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('../../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => componentMocks.announce,
}));
vi.mock('../../../services/ai/deviceHealthService', () => ({
  getHealthReport: () => componentMocks.healthReport(),
  getModelRecommendation: () => componentMocks.modelRec(),
}));
vi.mock('../../../services/localAiFacade', () => ({
  preloadLocalModel: vi.fn(),
  getLastLocalThroughput: () => null,
  getReadyLocalModelIds: () => componentMocks.getReady(),
  clearReadyLocalModels: () => componentMocks.clearReady(),
  abortActivePreload: () => componentMocks.abortPreload(),
  isLocalAiBusy: () => componentMocks.busy(),
  subscribeLocalModelReady: () => () => {},
}));
vi.mock('../../../components/settings/LocalAiDownloadProgress', () => ({
  LocalAiDownloadProgress: () => null,
}));

vi.mock('../../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { LocalAiSection } from '../../../components/settings/LocalAiSection';
import {
  clearLocalModels,
  estimateLocalModelStorage,
  LOCAL_MODEL_CACHE_PATTERNS,
} from '../../../services/ai/localModelStorageService';

const MB = 1_048_576;
const WORLD_SCRIPT_TRANSFORMERS_CACHE = 'worldscript-transformers-cache';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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
const transformersConsumers = [
  'packages/ai-core/src/index.ts',
  'services/voice/wasmSttEngine.ts',
  'services/voice/kokoroTtsEngine.ts',
  'services/voice/voiceCommandService.ts',
  'workers/v2/inference.worker.ts',
];
const ignoredDirectories = new Set([
  '.git',
  '.worktrees',
  'dist',
  'node_modules',
  'public',
  'reports',
  'tests',
]);

async function listSourceFiles(directory: string, relativeDirectory = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name) || entry.name.startsWith('.')) continue;
      files.push(
        ...(await listSourceFiles(
          resolve(directory, entry.name),
          join(relativeDirectory, entry.name),
        )),
      );
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(join(relativeDirectory, entry.name));
    }
  }
  return files;
}

function normalizeSourcePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function installCaches(names: string[], deleteImpl?: (name: string) => Promise<boolean>) {
  const remaining = new Set(names);
  const del = vi.fn(async (name: string) => {
    const deleted = await (deleteImpl?.(name) ?? Promise.resolve(true));
    if (deleted) remaining.delete(name);
    return deleted;
  });
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => [...remaining]),
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
  componentMocks.detectWebGpu.mockReturnValue(true);
  componentMocks.healthReport.mockResolvedValue({
    deviceClass: 'mid-range',
    gpuVramTier: 'medium',
  });
  componentMocks.modelRec.mockReturnValue('m-small');
  componentMocks.getReady.mockReturnValue(['m-small']);
  componentMocks.busy.mockReturnValue(false);
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
    // Vendor-global and WebLLM buckets are retained; only the positively owned app bucket counts.
    expect(est.modelCacheCount).toBe(1);
  });

  it('reports estimate-unavailable (null sizes) when only the Cache API is present', async () => {
    vi.stubGlobal('navigator', {}); // no StorageManager → quota unknown
    installCaches([WORLD_SCRIPT_TRANSFORMERS_CACHE]);
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
  it('releases engines + sessions and deletes only the WorldScript-owned bucket', async () => {
    const del = installCaches(ALL_CACHE_NAMES);

    const result = await clearLocalModels();

    expect(releaseAllWebLlmEngines).toHaveBeenCalledTimes(1);
    expect(releaseAllOnnxSessions).toHaveBeenCalledTimes(1);
    expect(result.clearedCaches).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(WORLD_SCRIPT_TRANSFORMERS_CACHE);
    expect(del).not.toHaveBeenCalledWith('webllm/model');
    expect(del).not.toHaveBeenCalledWith('webllm/config');
    expect(del).not.toHaveBeenCalledWith('webllm/wasm');
    expect(del).not.toHaveBeenCalledWith('transformers-cache');
    expect(del).not.toHaveBeenCalledWith('experimental_transformers-hash-cache');
    expect(del).not.toHaveBeenCalledWith('worldscript-logs-db');
  });

  it('does not count a rejected delete and leaves the owned bucket present', async () => {
    installCaches(ALL_CACHE_NAMES, async (name) => {
      if (name === WORLD_SCRIPT_TRANSFORMERS_CACHE) throw new Error('synthetic cache failure');
      return true;
    });

    const result = await clearLocalModels();
    expect(result.clearedCaches).toBe(0);
    expect(result.failedCaches).toBe(1);
    const estimate = await estimateLocalModelStorage();
    expect(estimate.modelCacheCount).toBe(1);
  });

  it('does not count a false delete as cleared', async () => {
    installCaches(ALL_CACHE_NAMES, async () => false);

    const result = await clearLocalModels();

    expect(result.clearedCaches).toBe(0);
    expect(result.failedCaches).toBe(1);
    expect(await estimateLocalModelStorage()).toMatchObject({ modelCacheCount: 1 });
  });

  it('reports cache enumeration failure so the UI does not announce a successful clear', async () => {
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => {
        throw new Error('synthetic cache listing failure');
      }),
      delete: vi.fn(),
    });

    await expect(clearLocalModels()).resolves.toEqual({ clearedCaches: 0, failedCaches: 1 });
  });

  it('announces a deletion failure while still resetting ready state and refreshing storage', async () => {
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => [WORLD_SCRIPT_TRANSFORMERS_CACHE]),
      delete: vi.fn(async () => false),
    });
    const estimate = vi.fn(async () => ({ usage: 100 * MB, quota: 1000 * MB }));
    vi.stubGlobal('navigator', { storage: { estimate } });

    const user = userEvent.setup();
    render(createElement(LocalAiSection));
    await screen.findByText('settings.ai.localAi.storageModelsCached');
    estimate.mockClear();

    await user.click(screen.getByText('settings.ai.localAi.clearButton'));
    await user.click(screen.getByText('settings.ai.localAi.clearConfirmYes'));

    await waitFor(() =>
      expect(componentMocks.announce).toHaveBeenCalledWith(
        'settings.ai.localAi.clearFailed',
        'polite',
      ),
    );
    expect(componentMocks.announce).not.toHaveBeenCalledWith(
      'settings.ai.localAi.clearedAnnounce',
      'polite',
    );
    expect(componentMocks.clearReady).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op delete count when the Cache API is absent', async () => {
    // Deterministic: explicitly remove the Cache API rather than relying on env defaults.
    vi.stubGlobal('caches', undefined);
    const result = await clearLocalModels();
    expect(releaseAllWebLlmEngines).toHaveBeenCalledTimes(1);
    expect(result.clearedCaches).toBe(0);
  });
});

describe('Transformers.js cache ownership boundary', () => {
  it('normalizes Windows paths for the ownership allowlist', () => {
    expect(normalizeSourcePath('packages\\ai-core\\src\\vendor-transformers.ts')).toBe(
      'packages/ai-core/src/vendor-transformers.ts',
    );
  });

  it.each(transformersConsumers)('%s loads Transformers through the owned proxy', async (path) => {
    const source = await readFile(resolve(repositoryRoot, path), 'utf8');

    expect(source).toContain('vendor-transformers');
    expect(source).not.toMatch(/(?:from\s+|import\s*\()\s*['"]@huggingface\/transformers['"]/);
  });

  it('keeps direct runtime imports confined to the ownership proxy', async () => {
    // QNBS-v3: Scan source files so a newly added consumer cannot bypass the proxy unnoticed.
    const sourceFiles = await listSourceFiles(repositoryRoot);
    const directImports: string[] = [];

    for (const path of sourceFiles) {
      const normalizedPath = normalizeSourcePath(path);
      if (normalizedPath === 'packages/ai-core/src/vendor-transformers.ts') continue;
      const source = await readFile(resolve(repositoryRoot, path), 'utf8');
      if (/(?:from\s+|import\s*\()\s*['"]@huggingface\/transformers['"]/.test(source)) {
        directImports.push(normalizedPath);
      }
    }

    expect(directImports).toEqual([]);
  });
});
