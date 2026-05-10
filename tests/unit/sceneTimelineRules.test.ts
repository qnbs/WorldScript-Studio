import { describe, expect, it } from 'vitest';
import {
  evaluateSceneTimeline,
  parseSceneDurationMs,
  parseSceneStartMs,
} from '../../services/sceneTimelineRules';
import type { StorySection } from '../../types';

describe('sceneTimelineRules', () => {
  it('parses ISO starts', () => {
    expect(parseSceneStartMs('2025-01-01')).not.toBeNull();
    expect(parseSceneStartMs('not-a-date')).toBeNull();
  });

  it('parses durations', () => {
    expect(parseSceneDurationMs('PT2H')).toBe(2 * 3_600_000);
    expect(parseSceneDurationMs('3 days')).toBe(3 * 86_400_000);
  });

  it('detects overlaps between consecutive scenes', () => {
    const sections: StorySection[] = [
      {
        id: 'a',
        title: 'A',
        content: '',
        sceneStart: '2025-01-01T10:00:00Z',
        sceneDuration: 'PT4H',
      },
      {
        id: 'b',
        title: 'B',
        content: '',
        sceneStart: '2025-01-01T11:00:00Z',
        sceneDuration: 'PT1H',
      },
    ];
    const hints = evaluateSceneTimeline(sections);
    expect(hints.some((h) => h.messageKey.endsWith('overlap'))).toBe(true);
  });
});
