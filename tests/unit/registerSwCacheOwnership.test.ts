// QNBS-v3: proves the Tauri-teardown cache cleanup in register-sw.ts never deletes an unowned cache.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { isWorldScriptOwnedCacheName, registerServiceWorker } from '../../register-sw';

const CURRENT_STATIC = 'worldscript-static-v1.28.1';
const FOREIGN_CACHE = 'some-other-github-pages-app-cache-v1';
const COLLIDING_FOREIGN_CACHE = 'worldscript-static-vendor-cache';

describe('register-sw — isWorldScriptOwnedCacheName', () => {
  it('accepts real owned cache names', () => {
    expect(isWorldScriptOwnedCacheName(CURRENT_STATIC)).toBe(true);
    expect(isWorldScriptOwnedCacheName('worldscript-dynamic-v1.28.1')).toBe(true);
    expect(isWorldScriptOwnedCacheName('worldscript-images-v1.28.1')).toBe(true);
  });

  it('rejects a foreign cache whose name merely shares the owned prefix', () => {
    expect(isWorldScriptOwnedCacheName(COLLIDING_FOREIGN_CACHE)).toBe(false);
    expect(isWorldScriptOwnedCacheName(FOREIGN_CACHE)).toBe(false);
  });
});

describe('register-sw — Tauri teardown never deletes an unowned cache', () => {
  let deletedNames: string[];
  let cacheStore: Set<string>;

  beforeEach(() => {
    deletedNames = [];
    cacheStore = new Set([CURRENT_STATIC, FOREIGN_CACHE, COLLIDING_FOREIGN_CACHE]);

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      writable: true,
      configurable: true,
      enumerable: true,
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: async () => [],
      },
      writable: true,
      configurable: true,
      enumerable: true,
    });

    Object.defineProperty(globalThis, 'caches', {
      value: {
        keys: async () => [...cacheStore],
        delete: async (name: string) => {
          deletedNames.push(name);
          return cacheStore.delete(name);
        },
      },
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error — test-only cleanup of a property this suite defines itself.
    delete window.__TAURI_INTERNALS__;
    // @ts-expect-error — jsdom's Navigator normally lacks serviceWorker; restore that absence.
    delete navigator.serviceWorker;
    // @ts-expect-error — jsdom lacks a global caches object by default; restore that absence.
    delete globalThis.caches;
  });

  it('deletes the owned cache but never the foreign caches, including the colliding-prefix one', async () => {
    await registerServiceWorker();
    expect(deletedNames).toContain(CURRENT_STATIC);
    expect(deletedNames).not.toContain(FOREIGN_CACHE);
    expect(deletedNames).not.toContain(COLLIDING_FOREIGN_CACHE);
    expect(cacheStore.has(FOREIGN_CACHE)).toBe(true);
    expect(cacheStore.has(COLLIDING_FOREIGN_CACHE)).toBe(true);
  });
});
