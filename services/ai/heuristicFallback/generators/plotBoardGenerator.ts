/**
 * Heuristic Plot-Board "suggest next beat" generator — framework-based next-move prompts when AI is
 * unavailable.
 *
 * QNBS-v3: Pure assembly of pre-resolved, already-localized labels (the hook owns `t`). Without a model
 * it can't read the live plot, so it offers structurally-sound generic next moves (escalate /
 * complicate / reverse) clearly framed as defaults. Returns `null` without labels.
 */

import type { PlotBeatSuggestion } from '../../../../features/project/thunks/plotBoardAiThunks';
import { registerHeuristicGenerator } from '../registry';
import type { HeuristicGenerator } from '../types';
import { makeHeuristicResult } from '../types';

/** Pre-resolved (translated) suggestion copy supplied by the hook. */
export interface PlotBeatHeuristicLabels {
  /** Where the suggested beats would slot in (e.g. "Right after the selected scene"). */
  readonly position: string;
  readonly beats: ReadonlyArray<{ title: string; description: string; rationale: string }>;
}

interface PlotBeatHeuristicParams {
  readonly labels?: PlotBeatHeuristicLabels;
}

export const plotBoardHeuristicGenerator: HeuristicGenerator<{ beats: PlotBeatSuggestion[] }> = (
  ctx,
) => {
  const params = (ctx.params ?? {}) as PlotBeatHeuristicParams;
  const labels = params.labels;
  if (!labels || labels.beats.length === 0) return null;

  const beats: PlotBeatSuggestion[] = labels.beats.map((beat) => ({
    title: beat.title,
    description: beat.description,
    suggestedPosition: labels.position,
    rationale: beat.rationale,
  }));

  return makeHeuristicResult(
    { beats },
    { confidence: 0.3, tier: 'basic', reasonKey: ctx.reasonKey ?? 'error.fallback.generic' },
  );
};

registerHeuristicGenerator('plotBoard.beat', plotBoardHeuristicGenerator);
