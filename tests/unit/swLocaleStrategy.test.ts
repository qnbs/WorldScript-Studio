// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// QNBS-v3: Regression guard for the i18n-staleness bug — returning users kept old translations
// (e.g. ar/he stub → full Beta) because the locale fetch handler in public/sw.js served the
// CACHE_DYNAMIC copy first (stale-while-revalidate) and the cache name is pinned to APP_VERSION,
// which doesn't bump on content-only i18n changes. The handler MUST be network-first so fresh
// translations always win online. sw.js is a classic service worker (uses `self`, not importable),
// so we assert its source contract instead of executing it.
const swSource = readFileSync(
  fileURLToPath(new URL('../../public/sw.js', import.meta.url)),
  'utf8',
);

/** Extract the body of the `if (url.pathname.includes('/locales/'))` fetch branch. */
function localeHandlerBlock(src: string): string {
  const start = src.indexOf("url.pathname.includes('/locales/')");
  expect(start).toBeGreaterThan(-1);
  // Grab a generous window covering the branch body.
  return src.slice(start, start + 600);
}

describe('service worker — locale bundle caching strategy', () => {
  it('handles /locales/ requests (the i18n bundles)', () => {
    expect(swSource).toContain("url.pathname.includes('/locales/')");
  });

  it('is network-first: fetches the network before any cache fallback', () => {
    const block = localeHandlerBlock(swSource);
    const fetchIdx = block.indexOf('await fetch(request)');
    const cacheMatchIdx = block.indexOf('cache.match(request)');
    expect(fetchIdx).toBeGreaterThan(-1);
    // Cache is only consulted as a fallback → it must appear AFTER the network fetch.
    expect(cacheMatchIdx).toBeGreaterThan(fetchIdx);
  });

  it('does NOT serve the cached bundle first (no stale-while-revalidate return)', () => {
    const block = localeHandlerBlock(swSource);
    // The old bug: `return cached || await fetchPr` returned the stale copy first.
    expect(block).not.toMatch(/return\s+cached\s*\|\|/);
  });

  it('still falls back to cache when the network is unavailable (offline support)', () => {
    const block = localeHandlerBlock(swSource);
    expect(block).toMatch(/catch[\s\S]*cache\.match\(request\)/);
  });

  it('falls back to cache on a non-OK response (transient 5xx/404 must not break translations)', () => {
    // QNBS-v3: 5xx/404 do not throw — after the `response.ok` check the handler must prefer the
    // cached bundle, otherwise a transient backend/CDN error returns a broken bundle.
    const block = localeHandlerBlock(swSource);
    expect(block).toMatch(/response\.ok[\s\S]*cache\.match\(request\)\s*\)\s*\|\|\s*response/);
  });
});
