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

// QNBS-v3: extracted from source (not hardcoded) so this test tracks the real constant, not a guess.
const admissionUrlMatch = swSource.match(/const PRECACHE_ADMISSION_URL\s*=\s*`\$\{BASE\}([^`]+)`/);
const extractedAdmissionSuffix = admissionUrlMatch?.[1];
if (!extractedAdmissionSuffix)
  throw new Error('Could not extract PRECACHE_ADMISSION_URL from public/sw.js');
const ADMISSION_MARKER_URL = `/WorldScript-Studio/${extractedAdmissionSuffix}`;

const CURRENT_STATIC = `worldscript-static-v${APP_VERSION}`;
const CURRENT_DYNAMIC = `worldscript-dynamic-v${APP_VERSION}`;
const CURRENT_IMAGES = `worldscript-images-v${APP_VERSION}`;
const STALE_STATIC = 'worldscript-static-v0.0.0-stale-test';
const FOREIGN_CACHE = 'some-other-github-pages-app-cache-v1';
// QNBS-v3: a startsWith('worldscript-static-v') predicate would wrongly treat this as owned.
const COLLIDING_FOREIGN_CACHE = 'worldscript-static-vendor-cache';

interface FakeCache {
  addAll: (urls: string[]) => Promise<void>;
  match: (key: string) => Promise<{ ok: true } | undefined>;
  put: (key: string, value: unknown) => Promise<void>;
  keys: () => Promise<never[]>;
}

interface FakeCaches {
  keys(): Promise<string[]>;
  open(name: string): Promise<FakeCache>;
  delete(name: string): Promise<boolean>;
  match(): Promise<undefined>;
  attemptedDeletes: string[];
  names(): string[];
}

function createFakeCaches(
  initialNames: string[],
  opts: { rejectOnDelete?: string; failAddAllFor?: string } = {},
): FakeCaches {
  const store = new Set(initialNames);
  const entries = new Map<string, Set<string>>();
  const attemptedDeletes: string[] = [];
  return {
    async keys() {
      return [...store];
    },
    async open(name: string) {
      store.add(name);
      if (!entries.has(name)) entries.set(name, new Set());
      const bucket = entries.get(name);
      if (!bucket) throw new Error('unreachable: bucket just inserted');
      return {
        addAll: async (urls: string[]) => {
          if (opts.failAddAllFor === name)
            throw new Error(`simulated precache failure for ${name}`);
          for (const url of urls) bucket.add(url);
        },
        match: async (key: string) => (bucket.has(key) ? { ok: true } : undefined),
        put: async (key: string) => {
          bucket.add(key);
        },
        keys: async () => [],
      };
    },
    async delete(name: string) {
      attemptedDeletes.push(name);
      if (name === opts.rejectOnDelete) throw new Error(`simulated delete failure for ${name}`);
      entries.delete(name);
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
  failAddAllFor?: string;
}) {
  const handlers: Record<string, SwHandler> = {};
  const fakeCaches = createFakeCaches(opts.initialCacheNames, {
    rejectOnDelete: opts.rejectOnDelete,
    failAddAllFor: opts.failAddAllFor,
  });
  const selfMock = {
    location: {
      protocol: opts.protocol,
      hostname: opts.hostname,
      pathname: '/WorldScript-Studio/sw.js',
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    addEventListener: (type: string, handler: SwHandler) => {
      handlers[type] = handler;
    },
    clients: { claim: async () => {} },
    registration: { unregister: async () => {} },
    skipWaiting: () => {},
    __WB_MANIFEST: [],
  };
  const context = vm.createContext({
    self: selfMock,
    caches: fakeCaches,
    console: selfMock.console,
    Response: class {
      constructor(public body?: unknown) {}
    },
  });
  vm.runInContext(swSource, context);
  // QNBS-v3: bracket-index + explicit throw satisfies noUncheckedIndexedAccess and yields non-optional SwHandler.
  const getHandler = (type: 'install' | 'activate' | 'message'): SwHandler => {
    const handler = handlers[type];
    if (!handler) throw new Error(`sw.js never registered a "${type}" listener`);
    return handler;
  };
  return { getHandler, fakeCaches };
}

async function runWaitUntil(handler: SwHandler, event: Record<string, unknown> = {}) {
  let captured: unknown;
  await handler({
    ...event,
    waitUntil: (p: unknown) => {
      captured = p;
    },
  });
  await captured;
}

/** Seeds CACHE_STATIC with the admission marker directly, simulating "a prior install already completed successfully" without re-running install. */
async function admitPrecache(fakeCaches: FakeCaches) {
  const cache = await fakeCaches.open(CURRENT_STATIC);
  await cache.put(ADMISSION_MARKER_URL, { ok: true });
}

describe('service worker — cache ownership (activate / CLEAR_CACHE never delete unowned caches)', () => {
  beforeAll(() => {
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('non-Tauri activate: prunes stale owned generations, keeps current owned and foreign caches', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [
        STALE_STATIC,
        CURRENT_STATIC,
        CURRENT_DYNAMIC,
        CURRENT_IMAGES,
        FOREIGN_CACHE,
      ],
    });
    await admitPrecache(fakeCaches);
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
    await admitPrecache(fakeCaches);
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
    await getHandler('message')({
      data: { type: 'CLEAR_CACHE' },
      source: { postMessage: () => {} },
    });
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
    await getHandler('message')({
      data: { type: 'CLEAR_CACHE' },
      source: { postMessage: () => {} },
    });
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
    await admitPrecache(fakeCaches);
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

  it('non-Tauri activate: never deletes a foreign cache whose name shares the owned prefix', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [CURRENT_STATIC, COLLIDING_FOREIGN_CACHE],
    });
    await admitPrecache(fakeCaches);
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.attemptedDeletes).not.toContain(COLLIDING_FOREIGN_CACHE);
    expect(fakeCaches.names()).toContain(COLLIDING_FOREIGN_CACHE);
  });

  it('CLEAR_CACHE: never deletes a foreign cache whose name shares the owned prefix', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [CURRENT_STATIC, COLLIDING_FOREIGN_CACHE],
    });
    await getHandler('message')({
      data: { type: 'CLEAR_CACHE' },
      source: { postMessage: () => {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeCaches.attemptedDeletes).not.toContain(COLLIDING_FOREIGN_CACHE);
    expect(fakeCaches.names()).toContain(COLLIDING_FOREIGN_CACHE);
  });
});

// QNBS-v3: regression coverage for #525 — a partial precache must never displace a working prior generation.
describe('service worker — precache admission gate (#525)', () => {
  it('successful install admits the new generation: activate prunes the previous complete generation', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC],
    });
    await runWaitUntil(getHandler('install'));
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.names()).not.toContain(STALE_STATIC);
    expect(fakeCaches.names()).toContain(CURRENT_STATIC);
  });

  it('failed precache never admits the new generation: activate preserves every existing cache, including the previous complete generation', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC],
      failAddAllFor: CURRENT_STATIC,
    });
    await runWaitUntil(getHandler('install'));
    await runWaitUntil(getHandler('activate'));
    // QNBS-v3: STALE_STATIC represents the previous, complete, last-known-good generation here.
    expect(fakeCaches.names()).toContain(STALE_STATIC);
    expect(fakeCaches.attemptedDeletes).not.toContain(STALE_STATIC);
  });

  it('a later successful install can still admit and prune after an earlier failed attempt (no permanent stuck state)', async () => {
    const { getHandler, fakeCaches } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC],
      failAddAllFor: CURRENT_STATIC,
    });
    await runWaitUntil(getHandler('install'));
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.names()).toContain(STALE_STATIC);

    // QNBS-v3: simulate a subsequent successful install for the same generation by admitting it directly.
    await admitPrecache(fakeCaches);
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.names()).not.toContain(STALE_STATIC);
    expect(fakeCaches.names()).toContain(CURRENT_STATIC);
  });
});
