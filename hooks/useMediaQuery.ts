import { useEffect, useState } from 'react';

/**
 * QNBS-v3: SSR-safe media-query hook. Returns whether `query` currently matches and updates on
 * change. Used to render a single responsive layout at a time (vs. mounting both and hiding one
 * with CSS), so heavy subtrees (e.g. ManuscriptEditor effects) don't run twice.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
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
