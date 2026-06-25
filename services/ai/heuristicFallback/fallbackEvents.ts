/**
 * QNBS-v3: Tiny observable for "a heuristic fallback just happened". The degraded-UX kit (Assisted
 * badge / toast) subscribes; telemetry reads the last event. Module-level singleton (mirrors
 * `aiUsageTracker`) — no Redux needed for this ephemeral signal.
 */

import type { HeuristicTier } from './types';

export interface HeuristicFallbackEvent {
  /** Task id the fallback fired for (e.g. `outline`, `writer.continue`). */
  readonly task: string;
  /** i18n key explaining why (e.g. `error.fallback.offline`). */
  readonly reasonKey: string;
  /** 0..1 confidence of the heuristic result. */
  readonly confidence: number;
  readonly tier: HeuristicTier;
  /** Epoch ms the event was recorded (injected by the recorder; deterministic-test friendly). */
  readonly at: number;
}

let _last: HeuristicFallbackEvent | null = null;
const _subscribers = new Set<(event: HeuristicFallbackEvent) => void>();

export function recordHeuristicFallback(event: HeuristicFallbackEvent): void {
  _last = event;
  for (const sub of _subscribers) {
    try {
      sub(event);
    } catch {
      /* a misbehaving subscriber must not break the AI path */
    }
  }
}

export function getLastHeuristicFallback(): HeuristicFallbackEvent | null {
  return _last;
}

export function subscribeHeuristicFallback(
  fn: (event: HeuristicFallbackEvent) => void,
): () => void {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

/** @internal Test isolation. */
export function _resetHeuristicFallbackEvents(): void {
  _last = null;
  _subscribers.clear();
}
