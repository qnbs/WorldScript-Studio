import { useEffect, useState } from 'react';

/**
 * QNBS-v3: SSR-safe media-query hook. Returns whether `query` currently matches and updates on
 * change. Used to render a single responsive layout at a time (vs. mounting both and hiding one
 * with CSS), so heavy subtrees (e.g. ManuscriptEditor effects) don't run twice.
 */

// QNBS-v3 (#179): when matchMedia is unavailable (very old WebViews / non-standard runtimes), evaluate
// a `(min-width:Npx)` / `(max-width:Npx)` query against window.innerWidth and keep it updated on
// resize — instead of returning a permanent `false`, which trapped callers (e.g. ManuscriptView) in
// the mobile layout forever regardless of the real viewport.
function evaluateFallback(query: string): boolean {
  if (typeof window === 'undefined') return false;
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/i.exec(query);
  if (min) return window.innerWidth >= Number.parseFloat(min[1] ?? '0');
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/i.exec(query);
  if (max) return window.innerWidth <= Number.parseFloat(max[1] ?? '0');
  return false;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : evaluateFallback(query),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // QNBS-v3 (#179): no matchMedia — track the viewport via resize so the result reflects the real
    // width and updates, rather than being stuck at the initial fallback value.
    if (typeof window.matchMedia !== 'function') {
      const onResize = () => setMatches(evaluateFallback(query));
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    // QNBS-v3: addEventListener is unavailable on older Safari/WebView MediaQueryList engines (<14),
    // where it would throw and break layout rendering — fall back to the deprecated addListener there.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);

  return matches;
}
