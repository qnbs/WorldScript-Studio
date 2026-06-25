/**
 * QNBS-v3: The single entry the provider layer calls when an AI request is terminally unavailable.
 * Runs the registered generator for `task` and, if it produces a result, records a fallback event so
 * the UI can show the "Assisted (offline)" state. Returns `null` when there is no generator — callers
 * then keep their existing error behavior, so wiring this in is always non-breaking.
 */

import { recordHeuristicFallback } from './fallbackEvents';
import { runHeuristicFallback } from './registry';
import type { HeuristicContext, HeuristicFallbackResult } from './types';

export function applyHeuristicFallback<T>(
  task: string | undefined,
  ctx: HeuristicContext,
  now: () => number = Date.now,
): HeuristicFallbackResult<T> | null {
  const result = runHeuristicFallback<T>(task, ctx);
  if (result && task) {
    recordHeuristicFallback({
      task,
      reasonKey: result.reasonKey,
      confidence: result.confidence,
      tier: result.tier,
      at: now(),
    });
  }
  return result;
}
