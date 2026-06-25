// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  _clearHeuristicRegistry,
  registerHeuristicGenerator,
  runHeuristicFallback,
} from '../../services/ai/heuristicFallback';
import {
  type CharacterHeuristicLabels,
  characterHeuristicGenerator,
} from '../../services/ai/heuristicFallback/generators/characterGenerator';
import {
  type WorldHeuristicLabels,
  worldHeuristicGenerator,
} from '../../services/ai/heuristicFallback/generators/worldGenerator';

const charLabels: CharacterHeuristicLabels = {
  name: 'New Character',
  backstory: 'B',
  motivation: 'M',
  appearance: 'A',
  personalityTraits: 'P',
  flaws: 'F',
  characterArc: 'C',
  relationships: 'R',
};
const worldLabels: WorldHeuristicLabels = {
  name: 'New World',
  description: 'D',
  geography: 'G',
  magicSystem: 'Mg',
  culture: 'Cu',
};

describe('characterHeuristicGenerator', () => {
  it('returns null without labels', () => {
    expect(characterHeuristicGenerator({ params: { concept: 'x' } })).toBeNull();
  });

  it('produces a complete Omit<Character,"id"> from labels', () => {
    const result = characterHeuristicGenerator({
      params: { concept: 'a spy', labels: charLabels },
    });
    expect(result?.isFallback).toBe(true);
    expect(result?.data).toEqual({
      name: 'New Character',
      backstory: 'B',
      motivation: 'M',
      appearance: 'A',
      personalityTraits: 'P',
      flaws: 'F',
      notes: '',
      characterArc: 'C',
      relationships: 'R',
    });
    // No leftover `id` field — the slice assigns it.
    expect('id' in (result?.data ?? {})).toBe(false);
  });

  it('confidence reflects whether a concept was supplied', () => {
    expect(
      characterHeuristicGenerator({ params: { concept: 'a spy', labels: charLabels } })?.confidence,
    ).toBe(0.45);
    expect(characterHeuristicGenerator({ params: { labels: charLabels } })?.confidence).toBe(0.35);
  });

  it('carries a provided reasonKey through the envelope', () => {
    const result = characterHeuristicGenerator({
      params: { labels: charLabels },
      reasonKey: 'error.fallback.offline',
    });
    expect(result?.reasonKey).toBe('error.fallback.offline');
  });

  it('resolves through the registry under "character.profile"', () => {
    _clearHeuristicRegistry();
    registerHeuristicGenerator('character.profile', characterHeuristicGenerator);
    expect(
      runHeuristicFallback('character.profile', { params: { labels: charLabels } })?.data,
    ).toBeTruthy();
  });
});

describe('worldHeuristicGenerator', () => {
  it('returns null without labels', () => {
    expect(worldHeuristicGenerator({ params: { concept: 'x' } })).toBeNull();
  });

  it('produces a complete Omit<World,"id"> with empty timeline/locations', () => {
    const result = worldHeuristicGenerator({
      params: { concept: 'a desert empire', labels: worldLabels },
    });
    expect(result?.data).toEqual({
      name: 'New World',
      description: 'D',
      geography: 'G',
      magicSystem: 'Mg',
      culture: 'Cu',
      notes: '',
      timeline: [],
      locations: [],
    });
    expect('id' in (result?.data ?? {})).toBe(false);
  });

  it('lowers confidence without a concept and carries a provided reasonKey', () => {
    expect(worldHeuristicGenerator({ params: { labels: worldLabels } })?.confidence).toBe(0.35);
    expect(
      worldHeuristicGenerator({
        params: { labels: worldLabels },
        reasonKey: 'error.fallback.offline',
      })?.reasonKey,
    ).toBe('error.fallback.offline');
  });

  it('resolves through the registry under "world.profile"', () => {
    _clearHeuristicRegistry();
    registerHeuristicGenerator('world.profile', worldHeuristicGenerator);
    expect(
      runHeuristicFallback('world.profile', { params: { labels: worldLabels } })?.data,
    ).toBeTruthy();
  });
});
