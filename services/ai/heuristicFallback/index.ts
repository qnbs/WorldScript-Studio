/**
 * QNBS-v3: Public surface for the heuristic-fallback layer. Services import from here; per-feature
 * generator modules register themselves via `registerHeuristicGenerator` at module load.
 */

export {
  _resetHeuristicFallbackEvents,
  getLastHeuristicFallback,
  type HeuristicFallbackEvent,
  recordHeuristicFallback,
  subscribeHeuristicFallback,
} from './fallbackEvents';
export {
  _clearHeuristicRegistry,
  _registeredHeuristicTasks,
  hasHeuristicGenerator,
  registerHeuristicGenerator,
  runHeuristicFallback,
} from './registry';
export { applyHeuristicFallback } from './seam';
export {
  clampConfidence,
  type HeuristicContext,
  type HeuristicFallbackResult,
  type HeuristicGenerator,
  type HeuristicTier,
  makeHeuristicResult,
} from './types';
