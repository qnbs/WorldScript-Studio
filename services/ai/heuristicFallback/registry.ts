/**
 * Heuristic-fallback generator registry.
 *
 * QNBS-v3: Modeled on `services/copilot/heuristicEngine.ts`'s pluggable rule registry. Each AI feature
 * registers ONE generator keyed by a stable task id (e.g. `outline`, `writer.continue`,
 * `character.profile`). The fallback seam in the provider layer calls `runHeuristicFallback(task, ctx)`
 * when an AI call is terminally unavailable; if no generator is registered for the task it returns
 * `null` and the caller keeps its existing behavior — so this layer is always safe to ship empty.
 */

import { createLogger } from '../../logger';
import type { HeuristicContext, HeuristicFallbackResult, HeuristicGenerator } from './types';

// QNBS-v3: lazy — never call createLogger at module load, so importing this module can't break tests
// that mock `services/logger` partially (the registry can sit in any module's static import graph).
let _log: ReturnType<typeof createLogger> | null = null;
const log = (): ReturnType<typeof createLogger> => {
  _log ??= createLogger('heuristicFallback');
  return _log;
};

const _registry = new Map<string, HeuristicGenerator>();

/**
 * Register a heuristic generator for a task. Idempotent (first registration wins) so module-load
 * self-registration cannot accidentally clobber an earlier one.
 */
export function registerHeuristicGenerator<T>(
  task: string,
  generator: HeuristicGenerator<T>,
): void {
  if (_registry.has(task)) return;
  _registry.set(task, generator as HeuristicGenerator);
}

/** True when a generator exists for the task — lets callers skip building context if there's no path. */
export function hasHeuristicGenerator(task: string | undefined): boolean {
  return task !== undefined && _registry.has(task);
}

/**
 * Run the registered generator for `task`. Returns its result, or `null` when there is no generator,
 * no task, or the generator throws/declines (degrade-safe — a heuristic must never crash a feature).
 */
export function runHeuristicFallback<T>(
  task: string | undefined,
  ctx: HeuristicContext,
): HeuristicFallbackResult<T> | null {
  if (!task) return null;
  const generator = _registry.get(task);
  if (!generator) return null;
  try {
    return generator(ctx) as HeuristicFallbackResult<T> | null;
  } catch {
    // A failing heuristic is itself a non-event: log and fall through to the caller's own behavior.
    log().warn('heuristic generator threw — no fallback produced', { task });
    return null;
  }
}

/** @internal Test isolation. */
export function _clearHeuristicRegistry(): void {
  _registry.clear();
}

/** @internal Test/diagnostics — list registered task ids. */
export function _registeredHeuristicTasks(): string[] {
  return [..._registry.keys()];
}
