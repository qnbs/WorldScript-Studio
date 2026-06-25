/**
 * Heuristic Character-profile generator — a structured starting profile when AI is unavailable.
 *
 * QNBS-v3: Pure assembly of pre-resolved, already-localized labels (the hook interpolates the user's
 * concept). Produces a schema-shaped `Omit<Character, 'id'>` scaffold the user then fleshes out;
 * returns `null` without labels so it never emits untranslated text.
 */

import type { Character } from '../../../../types';
import { registerHeuristicGenerator } from '../registry';
import type { HeuristicGenerator } from '../types';
import { makeHeuristicResult } from '../types';

/** Pre-resolved (translated, concept-interpolated) field copy supplied by the hook. */
export interface CharacterHeuristicLabels {
  readonly name: string;
  readonly backstory: string;
  readonly motivation: string;
  readonly appearance: string;
  readonly personalityTraits: string;
  readonly flaws: string;
  readonly characterArc: string;
  readonly relationships: string;
}

interface CharacterHeuristicParams {
  readonly concept?: string;
  readonly labels?: CharacterHeuristicLabels;
}

export const characterHeuristicGenerator: HeuristicGenerator<Omit<Character, 'id'>> = (ctx) => {
  const params = (ctx.params ?? {}) as CharacterHeuristicParams;
  const labels = params.labels;
  if (!labels) return null;

  const profile: Omit<Character, 'id'> = {
    name: labels.name,
    backstory: labels.backstory,
    motivation: labels.motivation,
    appearance: labels.appearance,
    personalityTraits: labels.personalityTraits,
    flaws: labels.flaws,
    notes: '',
    characterArc: labels.characterArc,
    relationships: labels.relationships,
  };

  const hasConcept = (params.concept ?? '').trim().length > 0;
  return makeHeuristicResult(profile, {
    confidence: hasConcept ? 0.45 : 0.35,
    tier: 'basic',
    reasonKey: ctx.reasonKey ?? 'error.fallback.generic',
  });
};

registerHeuristicGenerator('character.profile', characterHeuristicGenerator);
