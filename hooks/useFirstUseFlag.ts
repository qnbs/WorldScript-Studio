// QNBS-v3: lightweight first-use flag for one-time UI hints (e.g. Writer mode coachmarks).
// Persistence routes through the synchronous services/storage UI-flag helper rather than touching
// localStorage directly, keeping UI-pref storage behind a single abstraction. Mirrors the LoRA
// onboarding "dismiss once" pattern without a Redux/Zustand dependency.
import { useCallback, useState } from 'react';
import { uiFlagStore } from '../services/storage/uiFlagStore';

/**
 * Returns `[seen, markSeen]` for a one-time UI hint keyed by `key`.
 * Storage failures (private mode, blocked storage) degrade gracefully to in-session dismissal.
 */
export function useFirstUseFlag(key: string): [boolean, () => void] {
  // QNBS-v3: keep the historical `hint-` namespace so existing dismissals survive the refactor
  // (localStorage key stays `worldscript-hint-<key>`).
  const flagKey = `hint-${key}`;
  const [seen, setSeen] = useState<boolean>(() => uiFlagStore.get(flagKey));

  const markSeen = useCallback(() => {
    setSeen(true);
    uiFlagStore.set(flagKey, true);
  }, [flagKey]);

  return [seen, markSeen];
}
