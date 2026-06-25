/**
 * Heuristic Outline generator — a structurally-sound chapter skeleton when AI is unavailable.
 *
 * QNBS-v3: Pure string assembly. All localized copy is pre-resolved by the triggering hook (which has
 * `t`) and passed in as `OutlineHeuristicLabels`; this generator only picks a beat per chapter and
 * fills the title template — it never calls `t`. Returns `null` (degrade to the caller's error) when
 * the labels weren't provided, so it can never emit untranslated text.
 */

import type { OutlineSection } from '../../../../types';
import { registerHeuristicGenerator } from '../registry';
import type { HeuristicGenerator } from '../types';
import { makeHeuristicResult } from '../types';

export type OutlineBeatKey =
  | 'setup'
  | 'incitingIncident'
  | 'risingAction'
  | 'midpoint'
  | 'complications'
  | 'twist'
  | 'climax'
  | 'resolution';

/** Pre-resolved (already-translated, user-input interpolated) copy supplied by the hook. */
export interface OutlineHeuristicLabels {
  readonly beats: Readonly<Record<OutlineBeatKey, { title: string; desc: string }>>;
}

interface OutlineHeuristicParams {
  readonly numChapters?: number;
  readonly includeTwist?: boolean;
  readonly idea?: string;
  readonly labels?: OutlineHeuristicLabels;
}

const MIDDLE_CYCLE: OutlineBeatKey[] = ['risingAction', 'complications', 'midpoint'];

/** Distribute a three-act beat sheet across `n` chapters. */
export function planOutlineBeats(n: number, includeTwist: boolean): OutlineBeatKey[] {
  if (n <= 0) return [];
  if (n === 1) return ['setup'];
  if (n === 2) return ['setup', 'resolution'];
  if (n === 3) return ['setup', 'climax', 'resolution'];

  const beats: OutlineBeatKey[] = new Array(n);
  beats[0] = 'setup';
  beats[1] = 'incitingIncident';
  beats[n - 1] = 'resolution';
  beats[n - 2] = 'climax';
  for (let i = 2; i < n - 2; i++) {
    beats[i] = MIDDLE_CYCLE[(i - 2) % MIDDLE_CYCLE.length] as OutlineBeatKey;
  }
  if (includeTwist && n >= 5) {
    const twistIdx = Math.max(2, Math.min(n - 3, Math.floor(n * 0.7)));
    beats[twistIdx] = 'twist';
  }
  return beats;
}

export const outlineHeuristicGenerator: HeuristicGenerator<OutlineSection[]> = (ctx) => {
  const params = (ctx.params ?? {}) as OutlineHeuristicParams;
  const labels = params.labels;
  if (!labels) return null; // no localized copy → cannot emit; degrade to the caller's behavior

  const requested = Math.trunc(params.numChapters ?? 0);
  const count = Math.min(
    60,
    Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : 12),
  );
  const beatKeys = planOutlineBeats(count, params.includeTwist === true);

  const sections: OutlineSection[] = beatKeys.map((beat, index) => {
    const beatLabel = labels.beats[beat];
    const section: OutlineSection = {
      id: `heuristic-outline-${index + 1}`,
      title: `${index + 1}. ${beatLabel.title}`,
      description: beatLabel.desc,
    };
    return beat === 'twist' ? { ...section, isTwist: true } : section;
  });

  // Weaving the user's own idea raises quality above a bare template.
  const hasIdea = (params.idea ?? '').trim().length > 0;
  return makeHeuristicResult(sections, {
    confidence: hasIdea ? 0.55 : 0.4,
    tier: hasIdea ? 'advanced' : 'basic',
    reasonKey: ctx.reasonKey ?? 'error.fallback.generic',
  });
};

registerHeuristicGenerator('outline', outlineHeuristicGenerator);
