// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  _clearHeuristicRegistry,
  registerHeuristicGenerator,
  runHeuristicFallback,
} from '../../services/ai/heuristicFallback';
import {
  type OutlineBeatKey,
  type OutlineHeuristicLabels,
  outlineHeuristicGenerator,
  planOutlineBeats,
} from '../../services/ai/heuristicFallback/generators/outlineGenerator';

const BEAT_KEYS: OutlineBeatKey[] = [
  'setup',
  'incitingIncident',
  'risingAction',
  'midpoint',
  'complications',
  'twist',
  'climax',
  'resolution',
];

const labels: OutlineHeuristicLabels = {
  beats: Object.fromEntries(
    BEAT_KEYS.map((k) => [k, { title: `T:${k}`, desc: `D:${k}` }]),
  ) as OutlineHeuristicLabels['beats'],
};

describe('planOutlineBeats', () => {
  it('handles tiny chapter counts', () => {
    expect(planOutlineBeats(0, false)).toEqual([]);
    expect(planOutlineBeats(1, false)).toEqual(['setup']);
    expect(planOutlineBeats(2, false)).toEqual(['setup', 'resolution']);
    expect(planOutlineBeats(3, false)).toEqual(['setup', 'climax', 'resolution']);
  });

  it('opens with setup/inciting and closes with climax/resolution for n>=4', () => {
    const beats = planOutlineBeats(8, false);
    expect(beats).toHaveLength(8);
    expect(beats[0]).toBe('setup');
    expect(beats[1]).toBe('incitingIncident');
    expect(beats[6]).toBe('climax');
    expect(beats[7]).toBe('resolution');
  });

  it('inserts exactly one twist when requested (n>=5)', () => {
    const beats = planOutlineBeats(10, true);
    expect(beats.filter((b) => b === 'twist')).toHaveLength(1);
    // No twist for tiny stories even if requested.
    expect(planOutlineBeats(3, true)).not.toContain('twist');
  });
});

describe('outlineHeuristicGenerator', () => {
  it('returns null without labels (cannot emit untranslated content)', () => {
    expect(outlineHeuristicGenerator({ params: { numChapters: 5 } })).toBeNull();
  });

  it('produces numbered, schema-shaped OutlineSection[] from labels', () => {
    const result = outlineHeuristicGenerator({
      params: { numChapters: 5, labels, idea: 'a heist' },
    });
    expect(result?.isFallback).toBe(true);
    expect(result?.tier).toBe('advanced'); // idea provided → higher tier
    expect(result?.data).toHaveLength(5);
    expect(result?.data[0]).toEqual({
      id: 'heuristic-outline-1',
      title: '1. T:setup',
      description: 'D:setup',
    });
    // Every section has the required fields.
    for (const s of result?.data ?? []) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.description).toBe('string');
    }
  });

  it('marks the twist section with isTwist', () => {
    const result = outlineHeuristicGenerator({
      params: { numChapters: 10, includeTwist: true, labels },
    });
    const twist = result?.data.find((s) => s.isTwist);
    expect(twist).toBeTruthy();
    expect(twist?.title).toContain('T:twist');
  });

  it('clamps the chapter count and defaults to 12 on bad input', () => {
    expect(outlineHeuristicGenerator({ params: { numChapters: 0, labels } })?.data).toHaveLength(
      12,
    );
    expect(outlineHeuristicGenerator({ params: { numChapters: 999, labels } })?.data).toHaveLength(
      60,
    );
    expect(outlineHeuristicGenerator({ params: { labels } })?.data).toHaveLength(12);
  });

  it('is the lower tier when no idea is supplied', () => {
    expect(outlineHeuristicGenerator({ params: { numChapters: 4, labels } })?.tier).toBe('basic');
  });

  it('resolves through the registry under the "outline" task', () => {
    // Register deterministically — the module-singleton registry is shared across test files.
    _clearHeuristicRegistry();
    registerHeuristicGenerator('outline', outlineHeuristicGenerator);
    const result = runHeuristicFallback('outline', { params: { numChapters: 3, labels } });
    expect(result?.data).toHaveLength(3);
  });
});
