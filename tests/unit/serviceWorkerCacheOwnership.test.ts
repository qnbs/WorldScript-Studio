// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

// QNBS-v3: proves the real activate/message handlers never delete a cache this app doesn't own.
const swPath = fileURLToPath(new URL('../../public/sw.js', import.meta.url));
const swSource = readFileSync(swPath, 'utf8');

const appVersionMatch = swSource.match(/const APP_VERSION\s*=\s*'([^']+)'/);
const extractedVersion = appVersionMatch?.[1];
if (!extractedVersion) throw new Error('Could not extract APP_VERSION from public/sw.js');
const APP_VERSION = extractedVersion;

const CURRENT_STATIC = `worldscript-static-v${APP_VERSION}`;
const CURRENT_DYNAMIC = `worldscript-dynamic-v${APP_VERSION}`;
const CURRENT_IMAGES = `worldscript-images-v${APP_VERSION}`;
const STALE_STATIC = 'worldscript-static-v0.0.0-stale-test';
const FOREIGN_CACHE = 'some-other-github-pages-app-cache-v1';

interface FakeCaches {
  keys(): Promise<string[]>;
  open(name: string): Promise<{
    addAll: () => Promise<void>;
    match: () => Promise<undefined>;
    put: () => Promise<void>;
    keys: () => Promise<never[]>;
  }>;
  delete(name: string): Promise<boolean>;
  match(): Promise<undefined>;
  attemptedDeletes: string[];
  names(): string[];
}

function createFakeCaches(initialNames: string[], rejectOnDelete?: string): FakeCaches {
  const store = new Set(initialNames);
  const attemptedDeletes: string[] = [];
  return {
    async keys() {
      return [...store];
    },
    async open() {
      return {
        addAll: async () => {},
        match: async () => undefined,
        put: async () => {},
        keys: async () => [],
      };
    },
    async delete(name: string) {
      attemptedDeletes.push(name);
      if (name === rejectOnDelete) throw new Error(`simulated delete failure for ${name}`);
      return store.delete(name);
    },
    async match() {
      return undefined;
    },
    attemptedDeletes,
    names: () => [...store],
  };
}

type SwHandler = (event: Record<string, unknown>) => unknown;

function loadServiceWorker(opts: {
  protocol: string;
  hostname: string;
  initialCacheNames: string[];
  rejectOnDelete?: string;
}) {
  const handlers: Record<string, SwHandler> = {};
  const fakeCaches = createFakeCaches(opts.initialCacheNames, opts.rejectOnDelete);
  const selfMock = {
    location: { protocol: opts.protocol, hostname: opts.hostname, pathname: '/WorldScript-Studio/sw.js' },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    addEventListener: (type: string, handler: SwHandler) => {
      handlers[type] = handler;
    },
    clients: { claim: async () => {} },
    registration: { unregister: async () => {} },
    skipWaiting: () => {},
    __WB_MANIFEST: [],
  };
  const context = vm.createContext({ self: selfMock, caches: fakeCaches, console: selfMock.console });
  vm.runInContext(swSource, context);
  // QNBS-v3: bracket-index + explicit throw satisfies noUncheckedIndexedAccess and yields non-optional SwHandler.
  const getHandler = (type: 'activate' | 'message'): SwHandler => {
    const handler = handlers[type];
    if (!handler) throw new Error(`sw.js never registered a "${type}" listener`);
    return handler;
  };
  return { getHandler, fakeCaches };
}

async function runWaitUntil(handler: SwHandler, event: Record<string, unknown> = {}) {
  let captured: unknown;
  await handler({ ...event, waitUntil: (p: unknown) => { captured = p; } });
  await captured;
}

describe('service worker — cache ownership (activate / CLEAR_CACHE never delete unowned caches)', () => {
  beforeAll(() => {
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('non-Tauri activate: prunes stale owned generations, keeps current owned and foreign caches', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC, CURRENT_STATIC, CURRENT_DYNAMIC, CURRENT_IMAGES, FOREIGN_CACHE],
    });
    await runWaitUntil(getHandler('activate'));
    const remaining = fakeCaches.names();
    expect(remaining).not.toContain(STALE_STATIC);
    expect(remaining).toContain(CURRENT_STATIC);
    expect(remaining).toContain(CURRENT_DYNAMIC);
    expect(remaining).toContain(CURRENT_IMAGES);
    expect(remaining).toContain(FOREIGN_CACHE);
  });

  it('non-Tauri activate: never attempts to delete a foreign cache', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC, CURRENT_STATIC, FOREIGN_CACHE],
    });
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.attemptedDeletes).not.toContain(FOREIGN_CACHE);
  });

  it('Tauri activate: deletes owned caches of any generation, never a foreign cache', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'tauri:',
      hostname: 'localhost',
      initialCacheNames: [STALE_STATIC, CURRENT_STATIC, CURRENT_DYNAMIC, FOREIGN_CACHE],
    });
    await runWaitUntil(getHandler('activate'));
    const remaining = fakeCaches.names();
    expect(remaining).not.toContain(STALE_STATIC);
    expect(remaining).not.toContain(CURRENT_STATIC);
    expect(remaining).not.toContain(CURRENT_DYNAMIC);
    expect(remaining).toContain(FOREIGN_CACHE);
    expect(fakeCaches.attemptedDeletes).not.toContain(FOREIGN_CACHE);
  });

  it('CLEAR_CACHE: deletes owned caches of any generation, never a foreign cache', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC, CURRENT_STATIC, CURRENT_IMAGES, FOREIGN_CACHE],
    });
    await getHandler('message')({ data: { type: 'CLEAR_CACHE' }, source: { postMessage: () => {} } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const remaining = fakeCaches.names();
    expect(remaining).not.toContain(STALE_STATIC);
    expect(remaining).not.toContain(CURRENT_STATIC);
    expect(remaining).not.toContain(CURRENT_IMAGES);
    expect(remaining).toContain(FOREIGN_CACHE);
  });

  it('CLEAR_CACHE: never attempts to delete a foreign cache', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [CURRENT_STATIC, FOREIGN_CACHE],
    });
    await getHandler('message')({ data: { type: 'CLEAR_CACHE' }, source: { postMessage: () => {} } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeCaches.attemptedDeletes).not.toContain(FOREIGN_CACHE);
  });

  it('non-Tauri activate: a failed owned-cache delete never causes a foreign cache to be deleted', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC, CURRENT_STATIC, FOREIGN_CACHE],
      rejectOnDelete: STALE_STATIC,
    });
    // QNBS-v3: Promise.all rejects on the simulated failure — activate's own promise chain rejects too.
    await expect(runWaitUntil(getHandler('activate'))).rejects.toThrow();
    expect(fakeCaches.attemptedDeletes).not.toContain(FOREIGN_CACHE);
    expect(fakeCaches.names()).toContain(FOREIGN_CACHE);
  });

  it('Tauri activate: a failed owned-cache delete is caught and never causes a foreign cache delete', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'tauri:',
      hostname: 'localhost',
      initialCacheNames: [STALE_STATIC, FOREIGN_CACHE],
      rejectOnDelete: STALE_STATIC,
    });
    // QNBS-v3: the Tauri branch wraps cleanup in try/catch, so this must resolve, not reject.
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.attemptedDeletes).not.toContain(FOREIGN_CACHE);
    expect(fakeCaches.names()).toContain(FOREIGN_CACHE);
  });
});
