// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  _clearHeuristicRegistry,
  registerHeuristicGenerator,
  runHeuristicFallback,
} from '../../services/ai/heuristicFallback';
import {
  type PlotBeatHeuristicLabels,
  plotBoardHeuristicGenerator,
} from '../../services/ai/heuristicFallback/generators/plotBoardGenerator';

const labels: PlotBeatHeuristicLabels = {
  position: 'After the scene',
  beats: [
    { title: 'Raise stakes', description: 'D1', rationale: 'R1' },
    { title: 'Complication', description: 'D2', rationale: 'R2' },
  ],
};

describe('plotBoardHeuristicGenerator', () => {
  it('returns null without labels or with empty beats', () => {
    expect(plotBoardHeuristicGenerator({ params: {} })).toBeNull();
    expect(
      plotBoardHeuristicGenerator({ params: { labels: { position: 'x', beats: [] } } }),
    ).toBeNull();
  });

  it('maps labels into schema-shaped PlotBeatSuggestion[] with the shared position', () => {
    const result = plotBoardHeuristicGenerator({
      params: { labels },
      reasonKey: 'error.fallback.offline',
    });
    expect(result?.isFallback).toBe(true);
    expect(result?.reasonKey).toBe('error.fallback.offline');
    expect(result?.data.beats).toEqual([
      {
        title: 'Raise stakes',
        description: 'D1',
        suggestedPosition: 'After the scene',
        rationale: 'R1',
      },
      {
        title: 'Complication',
        description: 'D2',
        suggestedPosition: 'After the scene',
        rationale: 'R2',
      },
    ]);
  });

  it('resolves through the registry under "plotBoard.beat"', () => {
    _clearHeuristicRegistry();
    registerHeuristicGenerator('plotBoard.beat', plotBoardHeuristicGenerator);
    const result = runHeuristicFallback<{ beats: unknown[] }>('plotBoard.beat', {
      params: { labels },
    });
    expect(result?.data.beats).toHaveLength(2);
  });
});
