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

// QNBS-v3: the one BASE every loadServiceWorker() call below uses via selfMock.location.pathname — shared so ADMISSION_MARKER_URL can never silently diverge from it.
const TEST_BASE = '/WorldScript-Studio/';

// QNBS-v3: only the suffix is extracted from source; TEST_BASE above is the single hardcoded value both this constant and selfMock.location.pathname derive from.
const admissionUrlMatch = swSource.match(/const PRECACHE_ADMISSION_URL\s*=\s*`\$\{BASE\}([^`]+)`/);
const extractedAdmissionSuffix = admissionUrlMatch?.[1];
if (!extractedAdmissionSuffix)
  throw new Error('Could not extract PRECACHE_ADMISSION_URL from public/sw.js');
const ADMISSION_MARKER_URL = `${TEST_BASE}${extractedAdmissionSuffix}`;

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
  opts: {
    rejectOnDelete?: string | undefined;
    failAddAllFor?: string | undefined;
    failAddAllTimes?: number | undefined;
    swHref: string;
  },
): FakeCaches {
  const store = new Set(initialNames);
  const entries = new Map<string, Set<string>>();
  const attemptedDeletes: string[] = [];
  // QNBS-v3: a countdown (not a fixed boolean) so the SAME fake caches instance can simulate a real second install attempt succeeding after an earlier one failed.
  let remainingAddAllFailures = opts.failAddAllTimes ?? (opts.failAddAllFor ? 1 : 0);
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
          if (opts.failAddAllFor === name && remainingAddAllFailures > 0) {
            remainingAddAllFailures--;
            throw new Error(`simulated precache failure for ${name}`);
          }
          // QNBS-v3: mirrors real Cache.addAll() — rejects when two entries resolve to the same absolute URL, even if their literal strings differ.
          const resolvedSeen = new Set<string>();
          for (const url of urls) {
            const resolved = new URL(url, opts.swHref).href;
            if (resolvedSeen.has(resolved)) {
              throw new Error(`simulated InvalidStateError: duplicate request for ${resolved}`);
            }
            resolvedSeen.add(resolved);
            bucket.add(url);
          }
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
  failAddAllTimes?: number;
  manifest?: Array<string | { url: string; revision: string }>;
}) {
  const handlers: Record<string, SwHandler> = {};
  // QNBS-v3: real service-worker scripts resolve bare manifest URLs relative to their own script location — the fake needs the same href to detect duplicate-request rejections realistically.
  const swHref = `${opts.protocol}//${opts.hostname}${TEST_BASE}sw.js`;
  const fakeCaches = createFakeCaches(opts.initialCacheNames, {
    rejectOnDelete: opts.rejectOnDelete,
    failAddAllFor: opts.failAddAllFor,
    failAddAllTimes: opts.failAddAllTimes,
    swHref,
  });
  let skipWaitingCallCount = 0;
  let clientsClaimCallCount = 0;
  const selfMock = {
    location: {
      protocol: opts.protocol,
      hostname: opts.hostname,
      pathname: `${TEST_BASE}sw.js`,
      href: swHref,
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    addEventListener: (type: string, handler: SwHandler) => {
      handlers[type] = handler;
    },
    clients: {
      claim: async () => {
        clientsClaimCallCount++;
      },
    },
    registration: { unregister: async () => {} },
    skipWaiting: () => {
      skipWaitingCallCount++;
    },
    __WB_MANIFEST: opts.manifest ?? [],
  };
  const context = vm.createContext({
    self: selfMock,
    caches: fakeCaches,
    console: selfMock.console,
    URL,
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
  return {
    getHandler,
    fakeCaches,
    skipWaitingCalls: () => skipWaitingCallCount,
    clientsClaimCalls: () => clientsClaimCallCount,
  };
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

// QNBS-v3: a rejected install can never reach 'installed'/'waiting', so register-sw.ts's SKIP_WAITING message can't reach an incomplete generation either — no extra gating needed there.
describe('service worker — precache admission gate (#525)', () => {
  it('failed addAll() causes the install waitUntil() promise to reject', async () => {
    const { getHandler } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [],
      failAddAllFor: CURRENT_STATIC,
      failAddAllTimes: 1,
    });
    await expect(runWaitUntil(getHandler('install'))).rejects.toThrow();
  });

  it('skipWaiting() is not called for a failed installation', async () => {
    const { getHandler, skipWaitingCalls } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [],
      failAddAllFor: CURRENT_STATIC,
      failAddAllTimes: 1,
    });
    await expect(runWaitUntil(getHandler('install'))).rejects.toThrow();
    expect(skipWaitingCalls()).toBe(0);
  });

  it('successful install completes, writes the admission marker and invokes skipWaiting()', async () => {
    const { getHandler, fakeCaches, skipWaitingCalls } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [],
    });
    await runWaitUntil(getHandler('install'));
    const staticCache = await fakeCaches.open(CURRENT_STATIC);
    expect(await staticCache.match(ADMISSION_MARKER_URL)).toBeTruthy();
    expect(skipWaitingCalls()).toBe(1);
  });

  it('successful activate after an admitted install prunes the previous owned generation', async () => {
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

  it('a later real successful install attempt after a failed one succeeds normally (no permanent stuck state)', async () => {
    const { getHandler, fakeCaches, clientsClaimCalls } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [STALE_STATIC],
      failAddAllFor: CURRENT_STATIC,
      failAddAllTimes: 1,
    });
    // QNBS-v3: the first attempt fails and must reject; activate must never run for a rejected install in real life, but even if reached the marker check still preserves the previous generation and never claims clients, as defense in depth.
    await expect(runWaitUntil(getHandler('install'))).rejects.toThrow();
    await runWaitUntil(getHandler('activate'));
    expect(fakeCaches.names()).toContain(STALE_STATIC);
    expect(fakeCaches.attemptedDeletes).not.toContain(STALE_STATIC);
    expect(clientsClaimCalls()).toBe(0);

    // QNBS-v3: a real second install attempt (same worker source and fake caches, not a marker shortcut) now succeeds because the failure countdown is exhausted.
    await runWaitUntil(getHandler('install'));
    await runWaitUntil(getHandler('activate'));
    expect(clientsClaimCalls()).toBe(1);
    expect(fakeCaches.names()).not.toContain(STALE_STATIC);
    expect(fakeCaches.names()).toContain(CURRENT_STATIC);
  });
});

// QNBS-v3: regression coverage for a review finding on the #525 fix itself — VitePWA's injected manifest independently discovers index.html/offline.html/favicon.svg, which must not collide with PRECACHE_URLS's own explicit entries for the same files.
describe('service worker — precache manifest deduplication (#525 follow-up)', () => {
  it('a manifest entry resolving to the same URL as an explicit shell asset does not trigger a duplicate-request rejection', async () => {
    const { getHandler, fakeCaches, skipWaitingCalls } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [],
      manifest: [
        { url: 'index.html', revision: 'abc123' },
        { url: 'offline.html', revision: 'def456' },
        { url: 'favicon.svg', revision: 'ghi789' },
        { url: 'assets/app-somehash.js', revision: '' },
      ],
    });
    await runWaitUntil(getHandler('install'));
    const staticCache = await fakeCaches.open(CURRENT_STATIC);
    expect(await staticCache.match(ADMISSION_MARKER_URL)).toBeTruthy();
    expect(skipWaitingCalls()).toBe(1);
  });

  it('two manifest entries that resolve to the same URL as each other (not the explicit list) do not trigger a duplicate-request rejection', async () => {
    // QNBS-v3: exercises the fake's InvalidStateError branch through real production dedup logic, not just the explicit-list case above — proves the rejection path is actually reachable and correctly avoided.
    const { getHandler, fakeCaches, skipWaitingCalls } = loadServiceWorker({
      protocol: 'https:',
      hostname: 'qnbs.github.io',
      initialCacheNames: [],
      manifest: [
        { url: 'assets/app-somehash.js', revision: '' },
        { url: 'assets/app-somehash.js', revision: '' },
      ],
    });
    await runWaitUntil(getHandler('install'));
    const staticCache = await fakeCaches.open(CURRENT_STATIC);
    expect(await staticCache.match(ADMISSION_MARKER_URL)).toBeTruthy();
    expect(skipWaitingCalls()).toBe(1);
  });
});
