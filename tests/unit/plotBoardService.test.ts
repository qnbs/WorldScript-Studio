import { describe, expect, it } from 'vitest';
import {
  autoLayoutScenes,
  BEAT_SHEETS,
  computeTensionCurve,
} from '../../services/plotBoardService';
import type { StorySection } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSection(overrides?: Partial<StorySection>): StorySection {
  return {
    id: 's1',
    title: 'Scene 1',
    content: '',
    status: 'draft',
    act: 1,
    ...overrides,
  };
}

// ── computeTensionCurve ────────────────────────────────────────────────────

describe('computeTensionCurve', () => {
  it('returns empty array for empty sections', () => {
    expect(computeTensionCurve([], {})).toEqual([]);
  });

  it('uses status auto-score when no override', () => {
    const sections = [
      makeSection({ id: 's1', status: 'draft' }),
      makeSection({ id: 's2', status: 'revised' }),
      makeSection({ id: 's3', status: 'final' }),
    ];
    const points = computeTensionCurve(sections, {});
    expect(points[0]!.score).toBe(2); // draft
    expect(points[1]!.score).toBe(7); // revised
    expect(points[2]!.score).toBe(9); // final
  });

  it('auto-scores outline correctly', () => {
    const points = computeTensionCurve([makeSection({ status: 'outline' })], {});
    expect(points[0]!.score).toBe(3);
  });

  it('auto-scores first-draft correctly', () => {
    const points = computeTensionCurve([makeSection({ status: 'first-draft' })], {});
    expect(points[0]!.score).toBe(5);
  });

  it('user override takes precedence', () => {
    const points = computeTensionCurve([makeSection({ id: 's1', status: 'draft' })], { s1: 8 });
    expect(points[0]!.score).toBe(8);
    expect(points[0]!.isOverridden).toBe(true);
  });

  it('marks non-overridden points as not overridden', () => {
    const points = computeTensionCurve([makeSection({ id: 's1' })], {});
    expect(points[0]!.isOverridden).toBe(false);
  });

  it('falls back to draft score for unknown status', () => {
    const section = makeSection({ id: 's1' });
    (section as { status: string }).status = 'unknown-status';
    const points = computeTensionCurve([section], {});
    expect(points[0]!.score).toBe(2);
  });

  it('preserves section title in output', () => {
    const points = computeTensionCurve([makeSection({ title: 'Chapter One' })], {});
    expect(points[0]!.sectionTitle).toBe('Chapter One');
  });

  it('handles section without status (undefined)', () => {
    const section: StorySection = { id: 's1', title: 'X', content: '' };
    const points = computeTensionCurve([section], {});
    expect(points[0]!.score).toBe(2);
  });

  it('processes multiple overrides independently', () => {
    const sections = [makeSection({ id: 'a' }), makeSection({ id: 'b' })];
    const points = computeTensionCurve(sections, { a: 6 });
    expect(points[0]!.score).toBe(6);
    expect(points[1]!.isOverridden).toBe(false);
  });
});

// ── autoLayoutScenes ────────────────────────────────────────────────────────

describe('autoLayoutScenes', () => {
  it('returns empty object for empty input', () => {
    expect(autoLayoutScenes([])).toEqual({});
  });

  it('assigns x/y to each section', () => {
    const sections = [makeSection({ id: 's1', act: 1 }), makeSection({ id: 's2', act: 2 })];
    const layout = autoLayoutScenes(sections);
    expect(Object.keys(layout)).toHaveLength(2);
    expect(layout['s1']).toBeDefined();
    expect(layout['s2']).toBeDefined();
  });

  it('act 1 sections have smaller x than act 2', () => {
    const sections = [makeSection({ id: 'a1', act: 1 }), makeSection({ id: 'b2', act: 2 })];
    const layout = autoLayoutScenes(sections);
    expect(layout['a1']!.x).toBeLessThan(layout['b2']!.x);
  });

  it('act 2 sections have smaller x than act 3', () => {
    const sections = [makeSection({ id: 'b', act: 2 }), makeSection({ id: 'c', act: 3 })];
    const layout = autoLayoutScenes(sections);
    expect(layout['b']!.x).toBeLessThan(layout['c']!.x);
  });

  it('stacks scenes vertically within an act', () => {
    const sections = [
      makeSection({ id: 's1', act: 1 }),
      makeSection({ id: 's2', act: 1 }),
      makeSection({ id: 's3', act: 1 }),
    ];
    const layout = autoLayoutScenes(sections);
    expect(layout['s1']!.y).toBeLessThan(layout['s2']!.y);
    expect(layout['s2']!.y).toBeLessThan(layout['s3']!.y);
  });

  it('places sections without act into act 1 column', () => {
    // Omit act entirely (not pass undefined — exactOptionalPropertyTypes)
    const sectionNoAct = makeSection({ id: 'x' });
    delete (sectionNoAct as Partial<StorySection>).act;
    const sections = [sectionNoAct, makeSection({ id: 'y', act: 1 })];
    const layout = autoLayoutScenes(sections);
    expect(layout['x']!.x).toBe(layout['y']!.x);
  });
});

// ── BEAT_SHEETS ──────────────────────────────────────────────────────────────

describe('BEAT_SHEETS', () => {
  it('three-act has 3 beats', () => {
    expect(BEAT_SHEETS['three-act']).toHaveLength(3);
  });

  it('save-the-cat has 14 beats', () => {
    expect(BEAT_SHEETS['save-the-cat']).toHaveLength(14);
  });

  it('heros-journey has 12 beats', () => {
    expect(BEAT_SHEETS['heros-journey']).toHaveLength(12);
  });

  it('all beat pct values are in 0–1 range', () => {
    for (const [, beats] of Object.entries(BEAT_SHEETS)) {
      for (const beat of beats) {
        expect(beat.pct).toBeGreaterThanOrEqual(0);
        expect(beat.pct).toBeLessThanOrEqual(1);
      }
    }
  });
});
