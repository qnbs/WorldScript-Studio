/**
 * Tests for services/ai/openrouterModels.ts
 * QNBS-v3: Cache validation, policy gating, model fetching, and key validation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOpenRouterModelCache,
  fetchOpenRouterModels,
  validateOpenRouterKey,
} from '../../../services/ai/openrouterModels';

const CACHE_KEY = 'storycraft-openrouter-models';

const mockAssertCloudAiAllowed = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowed: (...args: unknown[]) => mockAssertCloudAiAllowed(...args),
}));

describe('openrouterModels', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockAssertCloudAiAllowed.mockResolvedValue(undefined);
    global.fetch = vi.fn();
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
        JSON.stringify({ fetchedAt: Date.now(), models: [{ id: 'cached/model:free' }] }),
      );

      const models = await fetchOpenRouterModels();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(models).toEqual([{ id: 'cached/model:free' }]);
    });

    it('ignores stale cached entries', async () => {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now() - 3_600_001, models: [{ id: 'stale/model:free' }] }),
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
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), models: [] }));
      clearOpenRouterModelCache();
      expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });
  });
});
