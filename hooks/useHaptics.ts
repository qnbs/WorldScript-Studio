// QNBS-v3: Named pattern library added in v1.6 — callers use semantic names instead of raw arrays.
const HAPTIC_PATTERNS = {
  'scene-drop': [10, 50, 10],
  'connection-made': [20, 30, 20, 30, 20],
  'streak-milestone': [50, 100, 50, 100, 200],
  'session-start': [30, 80, 30],
  'goal-achieved': [100, 50, 200, 50, 100],
  error: [80],
} as const;

export type HapticPattern = keyof typeof HAPTIC_PATTERNS;

/**
 * Thin wrapper around navigator.vibrate() with graceful degradation.
 * QNBS-v3: navigator.vibrate is absent on iOS and some desktop browsers — always guard.
 */
export function useHaptics(): {
  vibrate: (pattern?: HapticPattern | number | number[]) => void;
  canVibrate: boolean;
} {
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  function vibrate(pattern: HapticPattern | number | number[] = 10): void {
    if (!canVibrate) return;
    // QNBS-v3: spread readonly tuple to mutable array — navigator.vibrate doesn't accept readonly
    const resolved: number | number[] =
      typeof pattern === 'string' ? [...HAPTIC_PATTERNS[pattern]] : pattern;
    try {
      navigator.vibrate(resolved);
    } catch {
      // Permission denied or API removed — ignore silently.
    }
  }

  return { vibrate, canVibrate };
}
