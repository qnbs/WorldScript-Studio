// QNBS-v3: P3 — evaluateSceneTimelineDuckDb via v_scene_overlap + section titles JOIN.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/duckdb/duckdbAnalytics', () => ({
  querySceneOverlapsWithTitles: vi.fn(),
}));

import { querySceneOverlapsWithTitles } from '../../services/duckdb/duckdbAnalytics';
import { evaluateSceneTimelineDuckDb } from '../../services/sceneTimelineRules';

const mockQuery = vi.mocked(querySceneOverlapsWithTitles);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([]);
});

describe('evaluateSceneTimelineDuckDb', () => {
  it('returns empty array when no overlaps found', async () => {
    const result = await evaluateSceneTimelineDuckDb('p1');
    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalledWith('p1', 32, undefined);
  });

  it('maps overlap rows to SceneTimelineHint with warn severity', async () => {
    mockQuery.mockResolvedValue([
      { section_a: 's1', section_b: 's2', title_a: 'Dawn Battle', title_b: 'River Crossing' },
    ]);

    const result = await evaluateSceneTimelineDuckDb('p1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'overlap-s1-s2',
      severity: 'warn',
      messageKey: 'sceneboard.timeline.overlap',
      params: { prev: 'Dawn Battle', next: 'River Crossing' },
    });
  });

  it('maps multiple overlaps to multiple hints', async () => {
    mockQuery.mockResolvedValue([
      { section_a: 's1', section_b: 's2', title_a: 'A', title_b: 'B' },
      { section_a: 's3', section_b: 's4', title_a: 'C', title_b: 'D' },
    ]);

    const result = await evaluateSceneTimelineDuckDb('p1');
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('overlap-s1-s2');
    expect(result[1]?.id).toBe('overlap-s3-s4');
  });

  it('passes AbortSignal to querySceneOverlapsWithTitles', async () => {
    const ctrl = new AbortController();
    await evaluateSceneTimelineDuckDb('p1', ctrl.signal);
    expect(mockQuery).toHaveBeenCalledWith('p1', 32, ctrl.signal);
  });
});
