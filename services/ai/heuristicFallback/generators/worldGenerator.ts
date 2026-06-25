/**
 * Heuristic World-profile generator — a structured world-bible scaffold when AI is unavailable.
 *
 * QNBS-v3: Pure assembly of pre-resolved, already-localized labels (the hook interpolates the user's
 * concept). Produces a schema-shaped `Omit<World, 'id'>` with empty `timeline`/`locations` for the
 * user to populate; returns `null` without labels so it never emits untranslated text.
 */

import type { World } from '../../../../types';
import { registerHeuristicGenerator } from '../registry';
import type { HeuristicGenerator } from '../types';
import { makeHeuristicResult } from '../types';

/** Pre-resolved (translated, concept-interpolated) field copy supplied by the hook. */
export interface WorldHeuristicLabels {
  readonly name: string;
  readonly description: string;
  readonly geography: string;
  readonly magicSystem: string;
  readonly culture: string;
}

interface WorldHeuristicParams {
  readonly concept?: string;
  readonly labels?: WorldHeuristicLabels;
}

export const worldHeuristicGenerator: HeuristicGenerator<Omit<World, 'id'>> = (ctx) => {
  const params = (ctx.params ?? {}) as WorldHeuristicParams;
  const labels = params.labels;
  if (!labels) return null;

  const profile: Omit<World, 'id'> = {
    name: labels.name,
    description: labels.description,
    geography: labels.geography,
    magicSystem: labels.magicSystem,
    culture: labels.culture,
    notes: '',
    timeline: [],
    locations: [],
  };

  const hasConcept = (params.concept ?? '').trim().length > 0;
  return makeHeuristicResult(profile, {
    confidence: hasConcept ? 0.45 : 0.35,
    tier: 'basic',
    reasonKey: ctx.reasonKey ?? 'error.fallback.generic',
  });
};

registerHeuristicGenerator('world.profile', worldHeuristicGenerator);
