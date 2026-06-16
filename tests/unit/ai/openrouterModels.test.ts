/**
 * Tests for services/ai/openrouterModels.ts
 * QNBS-v3: Cache validation, policy gating, model fetching, and key validation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOpenRouterModelCache,
  fetchOpenRouterModels,
  validateOpenRouterKey,
} from '../../../services/ai/openrouterModels';

const CACHE_KEY = 'worldscript-openrouter-models';
// QNBS-v3: Freeze the clock so cache TTL assertions never depend on real wall-clock time.
const FIXED_NOW = 1_700_000_000_000;
// QNBS-v3: Capture the real fetch so teardown can restore it — these tests overwrite global.fetch
// and must not leak the stub into unrelated suites.
const originalFetch = global.fetch;

const mockAssertCloudAiAllowed = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowed: (...args: unknown[]) => mockAssertCloudAiAllowed(...args),
}));

describe('openrouterModels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    localStorage.clear();
    vi.clearAllMocks();
    mockAssertCloudAiAllowed.mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    // QNBS-v3: Guaranteed restore of the global fetch so a failing test can't leak the stub.
    global.fetch = originalFetch;
  });

  describe('readCache', () => {
    it('ignores malformed cache entries', async () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: 'not-a-number', models: {} }));
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'x/y:free' }] }),
      } as unknown as Response);

      const models = await fetchOpenRouterModels();
      expect(global.fetch).toHaveBeenCalled();
      expect(models).toHaveLength(1);
    });

    it('returns valid cached entries without fetching', async () => {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ fetchedAt: FIXED_NOW, models: [{ id: 'cached/model:free' }] }),
      );

      const models = await fetchOpenRouterModels();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(models).toEqual([{ id: 'cached/model:free' }]);
    });

    it('preserves contextLength across a cache round-trip', async () => {
      // QNBS-v3: Regression — cached models are stored in the normalized `contextLength` shape,
      // so re-normalizing them on read must accept that key and not drop the field to undefined.
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          fetchedAt: FIXED_NOW,
          models: [{ id: 'cached/model:free', contextLength: 8192 }],
        }),
      );

      const models = await fetchOpenRouterModels();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(models[0]?.contextLength).toBe(8192);
    });

    it('does not reuse a cache from a different credential scope', async () => {
      // QNBS-v3: Regression — an anonymously fetched catalog (authed:false) must not be served to a
      // request made with an API key (authed:true); the differing scope forces a fresh fetch.
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          fetchedAt: FIXED_NOW,
          authed: false,
          models: [{ id: 'anon/model:free' }],
        }),
      );
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'authed/model' }] }),
      } as unknown as Response);

      const models = await fetchOpenRouterModels('sk-or-v1-secret-key');
      expect(global.fetch).toHaveBeenCalled();
      expect(models).toEqual([{ id: 'authed/model' }]);
    });

    it('ignores stale cached entries', async () => {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ fetchedAt: FIXED_NOW - 3_600_001, models: [{ id: 'stale/model:free' }] }),
      );
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'fresh/model:free' }] }),
      } as unknown as Response);

      const models = await fetchOpenRouterModels();
      expect(global.fetch).toHaveBeenCalled();
      expect(models).toEqual([{ id: 'fresh/model:free' }]);
    });
  });

  describe('fetchOpenRouterModels', () => {
    it('throws when cloud AI policy blocks the request', async () => {
      mockAssertCloudAiAllowed.mockRejectedValue(new Error('blocked'));

      await expect(fetchOpenRouterModels()).rejects.toThrow('blocked');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('parses and sorts the model list', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'b/model', name: 'B' }, { id: 'a/model', name: 'A' }, { id: 123 }],
        }),
      } as unknown as Response);

      const models = await fetchOpenRouterModels();
      expect(models.map((m) => m.id)).toEqual(['a/model', 'b/model']);
    });

    it('throws on non-OK response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as unknown as Response);

      await expect(fetchOpenRouterModels()).rejects.toThrow('503');
    });
  });

  describe('validateOpenRouterKey', () => {
    it('returns EMPTY_KEY for empty input', async () => {
      const result = await validateOpenRouterKey('   ');
      expect(result).toEqual({ ok: false, error: 'EMPTY_KEY' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns ok:true on valid key', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
      } as unknown as Response);

      const result = await validateOpenRouterKey('sk-or-v1-test');
      expect(result.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalled();
    });

    it('returns INVALID_KEY on 401', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
      } as unknown as Response);

      const result = await validateOpenRouterKey('bad-key');
      expect(result).toEqual({ ok: false, error: 'INVALID_KEY' });
    });

    it('returns TIMEOUT on AbortError', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DOMException('Timeout', 'AbortError'),
      );

      const result = await validateOpenRouterKey('sk-or-v1-test');
      expect(result).toEqual({ ok: false, error: 'TIMEOUT' });
    });

    it('blocks validation when cloud AI policy rejects', async () => {
      mockAssertCloudAiAllowed.mockRejectedValue(new Error('blocked'));

      await expect(validateOpenRouterKey('sk-or-v1-test')).rejects.toThrow('blocked');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('clearOpenRouterModelCache', () => {
    it('removes the cache entry', () => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: FIXED_NOW, models: [] }));
      clearOpenRouterModelCache();
      expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });
  });
});
