import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as StaticTranslateModule from '../../../services/i18n/staticTranslate';

// QNBS-v3: unit tests for the middleware-safe static i18n accessor used by app/listenerMiddleware.ts; re-imports fresh per test via vi.resetModules() to avoid the module-scoped bundle cache bleeding across tests.
async function importFresh(): Promise<typeof StaticTranslateModule> {
  vi.resetModules();
  return import('../../../services/i18n/staticTranslate');
}

describe('staticTranslate', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('getCurrentLanguage', () => {
    it('returns "en" when nothing is persisted', async () => {
      const { getCurrentLanguage } = await importFresh();
      expect(getCurrentLanguage()).toBe('en');
    });

    it('returns the persisted language when valid', async () => {
      localStorage.setItem('worldscript-language', 'de');
      const { getCurrentLanguage } = await importFresh();
      expect(getCurrentLanguage()).toBe('de');
    });

    it('falls back to "en" for an invalid persisted value', async () => {
      localStorage.setItem('worldscript-language', 'not-a-real-language');
      const { getCurrentLanguage } = await importFresh();
      expect(getCurrentLanguage()).toBe('en');
    });
  });

  describe('getStaticTranslation', () => {
    it('resolves a key from the active language bundle', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 'greeting.hello': 'Hallo' }),
      }) as unknown as typeof fetch;

      const { getStaticTranslation } = await importFresh();
      const result = await getStaticTranslation('greeting.hello', 'de');
      expect(result).toBe('Hallo');
    });

    it('falls back to English when the key is missing from the active language bundle', async () => {
      global.fetch = vi.fn((url: string) => {
        if (url.includes('/de/')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 'greeting.hello': 'Hello' }),
        });
      }) as unknown as typeof fetch;

      const { getStaticTranslation } = await importFresh();
      const result = await getStaticTranslation('greeting.hello', 'de');
      expect(result).toBe('Hello');
    });

    it('falls back to the raw key when missing everywhere', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }) as unknown as typeof fetch;

      const { getStaticTranslation } = await importFresh();
      const result = await getStaticTranslation('does.not.exist', 'en');
      expect(result).toBe('does.not.exist');
    });

    it('interpolates {{placeholder}} replacements', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 'greeting.named': 'Hello, {{name}}!' }),
      }) as unknown as typeof fetch;

      const { getStaticTranslation } = await importFresh();
      const result = await getStaticTranslation('greeting.named', 'en', { name: 'Ada' });
      expect(result).toBe('Hello, Ada!');
    });

    it('returns the raw key when the fetch rejects', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

      const { getStaticTranslation } = await importFresh();
      const result = await getStaticTranslation('greeting.hello', 'en');
      expect(result).toBe('greeting.hello');
    });
  });
});
