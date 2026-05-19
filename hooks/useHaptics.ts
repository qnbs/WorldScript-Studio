/**
 * Thin wrapper around navigator.vibrate() with graceful degradation.
 * QNBS-v3: navigator.vibrate is absent on iOS and some desktop browsers — always guard.
 */
export function useHaptics(): {
  vibrate: (pattern?: number | number[]) => void;
  canVibrate: boolean;
} {
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  function vibrate(pattern: number | number[] = 10): void {
    if (canVibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Permission denied or API removed — ignore silently.
      }
    }
  }

  return { vibrate, canVibrate };
}
