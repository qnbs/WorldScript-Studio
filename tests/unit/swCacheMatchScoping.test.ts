// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// QNBS-v3: regression guard for #514 — CacheStorage is origin-scoped, not path-scoped, so a bare
// caches.match(request) on a shared origin like qnbs.github.io searches every cache on the origin,
// not just this app's own. sw.js is a classic service worker (uses `self`, not importable), so we
// assert its source contract instead of executing it, mirroring swLocaleStrategy.test.ts's pattern.
const swSource = readFileSync(
  fileURLToPath(new URL('../../public/sw.js', import.meta.url)),
  'utf8',
);

/** Extract the body of the `self.addEventListener('fetch', ...)` handler. */
function fetchHandlerBlock(src: string): string {
  const start = src.indexOf("self.addEventListener('fetch'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("self.addEventListener('message'", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Extract the body of the `offlineFallback` helper, called from every fetch-handler catch path. */
function offlineFallbackBlock(src: string): string {
  const start = src.indexOf('async function offlineFallback');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Every top-level `caches.match(...)` call found in a source block (not `cache.match(...)` on an already-opened, already-scoped handle). Strips `//` comments first so prose mentioning `caches.match()` can't masquerade as a real call site, and normalizes the `${BASE}` interpolation to a plain placeholder so expected-value strings in this file never need to embed a real template-literal placeholder themselves. */
function cachesDotMatchCalls(block: string): string[] {
  const codeOnly = block
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const calls: string[] = [];
  const re = /\bcaches\.match\([^;]*?\)/g;
  let m: RegExpExecArray | null = re.exec(codeOnly);
  while (m !== null) {
    calls.push(m[0].replace(/\$\{BASE\}/, '<BASE>'));
    m = re.exec(codeOnly);
  }
  return calls;
}

describe('service worker — caches.match() is always scoped to an owned cache (#514)', () => {
  it('the fetch handler contains exactly the 3 known caches.match() call sites', () => {
    // QNBS-v3: exact count, not a lower bound — a lower bound would let a call site silently disappear (e.g. an accidental merge/refactor) without this regression test failing.
    const calls = cachesDotMatchCalls(fetchHandlerBlock(swSource));
    expect(calls.length).toBe(3);
  });

  it('the JS/CSS Cache-First lookup reads from CACHE_STATIC, where the network path writes it', () => {
    const start = swSource.indexOf('JS / CSS bundles');
    expect(start).toBeGreaterThan(-1);
    const end = swSource.indexOf('Locale JSON', start);
    expect(end).toBeGreaterThan(start);
    const calls = cachesDotMatchCalls(swSource.slice(start, end));
    expect(calls).toEqual(['caches.match(request, { cacheName: CACHE_STATIC })']);
  });

  it("the navigation fallback reads the navigated URL from CACHE_DYNAMIC and the SPA shell from CACHE_STATIC — not each other's cache", () => {
    const start = swSource.indexOf('Navigation — Network First');
    expect(start).toBeGreaterThan(-1);
    const end = swSource.indexOf('Everything else', start);
    expect(end).toBeGreaterThan(start);
    const calls = cachesDotMatchCalls(swSource.slice(start, end));
    expect(calls).toEqual([
      'caches.match(request, { cacheName: CACHE_DYNAMIC })',
      'caches.match(`<BASE>index.html`, { cacheName: CACHE_STATIC })',
    ]);
  });

  it('offlineFallback (reachable from every fetch-handler catch path) reads offline.html from CACHE_STATIC, where it is precached', () => {
    const calls = cachesDotMatchCalls(offlineFallbackBlock(swSource));
    expect(calls).toEqual(['caches.match(`<BASE>offline.html`, { cacheName: CACHE_STATIC })']);
  });
});
