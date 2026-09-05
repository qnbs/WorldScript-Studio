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

/** Every top-level `caches.match(...)` call found in a source block (not `cache.match(...)` on an already-opened, already-scoped handle). Strips `//` comments first so prose mentioning `caches.match()` can't masquerade as a real call site. */
function cachesDotMatchCalls(block: string): string[] {
  const codeOnly = block
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const calls: string[] = [];
  const re = /\bcaches\.match\([^;]*?\)/g;
  let m: RegExpExecArray | null = re.exec(codeOnly);
  while (m !== null) {
    calls.push(m[0]);
    m = re.exec(codeOnly);
  }
  return calls;
}

describe('service worker — caches.match() is always scoped to an owned cache (#514)', () => {
  it('the fetch handler contains at least the known caches.match() call sites', () => {
    const calls = cachesDotMatchCalls(fetchHandlerBlock(swSource));
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('every caches.match() call in the fetch handler passes an explicit cacheName', () => {
    const calls = cachesDotMatchCalls(fetchHandlerBlock(swSource));
    for (const call of calls) {
      expect(call).toMatch(/cacheName:\s*CACHE_(STATIC|DYNAMIC|IMAGES)/);
    }
  });

  it('offlineFallback (reachable from every fetch-handler catch path) also scopes its caches.match()', () => {
    const calls = cachesDotMatchCalls(offlineFallbackBlock(swSource));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(call).toMatch(/cacheName:\s*CACHE_(STATIC|DYNAMIC|IMAGES)/);
    }
  });
});
