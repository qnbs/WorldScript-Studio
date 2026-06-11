/**
 * insightGenerator — debounced, LRU-cached proactive insight producer.
 * QNBS-v3: Wraps heuristicEngine.runAllRules with a 400ms debounce and a 10-entry LRU keyed
 * by a lightweight content hash so re-renders never trigger redundant analysis.
 * All heavy work stays off the React render cycle (called from a listenerMiddleware handler).
 */

import type { ProjectData } from '../../features/project/projectState';
import type { CopilotContext } from './copilotContextService';
import { type HeuristicFinding, runAllRules } from './heuristicEngine';

// ---------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------

const CACHE_SIZE = 10;
const _cache = new Map<string, HeuristicFinding[]>();

function evictIfNeeded(): void {
  if (_cache.size >= CACHE_SIZE) {
    // Map iteration order is insertion-order → first key is oldest
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
}

/** Lightweight hash of project state: manuscript length + char count + word totals. */
function projectHash(project: ProjectData, language: string): string {
  const manuscriptSig = project.manuscript
    .slice(0, 20) // cap for performance
    .map((s) => `${s.id}:${s.content?.length ?? 0}`)
    .join('|');
  const charCount = Object.keys(project.characters.entities).length;
  const worldCount = Object.keys(project.worlds.entities).length;
  return `${language}:${charCount}:${worldCount}:${manuscriptSig}`;
}

// ---------------------------------------------------------------------------
// Debounce handle
// ---------------------------------------------------------------------------

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule an insight generation pass 400ms from now (cancels any pending pass).
 * The `onReady` callback receives the insight array; call it to dispatch into Redux.
 */
export function scheduleInsightGeneration(
  project: ProjectData,
  ctx: CopilotContext,
  onReady: (findings: HeuristicFinding[]) => void,
  delayMs = 400,
): void {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
  }
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    const hash = projectHash(project, ctx.language);
    const cached = _cache.get(hash);
    if (cached) {
      onReady(cached);
      return;
    }
    // Cap analysis to first 20 chapters for low-end hardware safety
    const cappedProject: ProjectData = {
      ...project,
      manuscript: project.manuscript.slice(0, 20),
    };
    const findings = runAllRules(cappedProject, ctx, 5);
    evictIfNeeded();
    _cache.set(hash, findings);
    onReady(findings);
  }, delayMs);
}

/** Cancel any pending debounce (e.g. when Copilot is closed). */
export function cancelInsightGeneration(): void {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
}

/** @internal Test isolation. */
export function _clearInsightCache(): void {
  _cache.clear();
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
}
