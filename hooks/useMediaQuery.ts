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
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
