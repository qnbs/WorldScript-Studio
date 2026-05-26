/**
 * Tests for services/plotBoardService.ts
 * QNBS-v3: Pure functions — computeTensionCurve, autoLayoutScenes, BEAT_SHEETS constant.
 */

import { describe, expect, it } from 'vitest';
import {
  autoLayoutScenes,
  BEAT_SHEETS,
  computeTensionCurve,
} from '../../../services/plotBoardService';
import type { StorySection } from '../../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(id: string, title: string, status: string, act?: number): StorySection {
  return {
    id,
    title,
    content: '',
    wordCount: 0,
    type: 'scene',
    order: 0,
    act: act ?? 1,
    status: status as StorySection['status'],
  } as StorySection;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeTensionCurve', () => {
  it('maps final status to score 9', () => {
    const sections = [makeSection('s1', 'Scene 1', 'final')];
    const [point] = computeTensionCurve(sections, {});
    expect(point?.score).toBe(9);
    expect(point?.isOverridden).toBe(false);
  });

  it('maps revised status to score 7', () => {
    const sections = [makeSection('s1', 'Scene 1', 'revised')];
    const [point] = computeTensionCurve(sections, {});
    expect(point?.score).toBe(7);
  });

  it('maps first-draft status to score 5', () => {
    const sections = [makeSection('s1', 'Scene 1', 'first-draft')];
    const [point] = computeTensionCurve(sections, {});
    expect(point?.score).toBe(5);
  });

  it('maps draft status to score 2', () => {
    const sections = [makeSection('s1', 'Scene 1', 'draft')];
    const [point] = computeTensionCurve(sections, {});
    expect(point?.score).toBe(2);
  });

  it('uses override score when section has an override', () => {
    const sections = [makeSection('s1', 'Scene 1', 'draft')];
    const [point] = computeTensionCurve(sections, { s1: 8 });
    expect(point?.score).toBe(8);
    expect(point?.isOverridden).toBe(true);
  });

  it('only overrides the specified section', () => {
    const sections = [makeSection('s1', 'Scene 1', 'draft'), makeSection('s2', 'Scene 2', 'draft')];
    const points = computeTensionCurve(sections, { s1: 10 });
    expect(points[0]?.isOverridden).toBe(true);
    expect(points[1]?.isOverridden).toBe(false);
    expect(points[1]?.score).toBe(2);
  });

  it('returns empty array for no sections', () => {
    expect(computeTensionCurve([], {})).toEqual([]);
  });

  it('returns sectionId and sectionTitle', () => {
    const sections = [makeSection('s1', 'My Scene', 'draft')];
    const [point] = computeTensionCurve(sections, {});
    expect(point?.sectionId).toBe('s1');
    expect(point?.sectionTitle).toBe('My Scene');
  });
});

describe('autoLayoutScenes', () => {
  it('returns empty object for no sections', () => {
    expect(autoLayoutScenes([])).toEqual({});
  });

  it('assigns x/y positions to each section', () => {
    const sections = [makeSection('s1', 'Scene 1', 'draft', 1)];
    const positions = autoLayoutScenes(sections);
    expect(positions['s1']).toBeDefined();
    expect(typeof positions['s1']?.x).toBe('number');
    expect(typeof positions['s1']?.y).toBe('number');
  });

  it('positions multiple sections in same act with different y', () => {
    const sections = [
      makeSection('s1', 'Scene 1', 'draft', 1),
      makeSection('s2', 'Scene 2', 'draft', 1),
    ];
    const positions = autoLayoutScenes(sections);
    expect(positions['s1']?.x).toBe(positions['s2']?.x);
    expect(positions['s1']?.y).not.toBe(positions['s2']?.y);
  });

  it('assigns different x offsets for different acts', () => {
    const sections = [
      makeSection('s1', 'Scene 1', 'draft', 1),
      makeSection('s2', 'Scene 2', 'draft', 2),
    ];
    const positions = autoLayoutScenes(sections);
    expect(positions['s1']?.x).not.toBe(positions['s2']?.x);
  });
});

describe('BEAT_SHEETS', () => {
  it('three-act has 3 markers', () => {
    expect(BEAT_SHEETS['three-act']).toHaveLength(3);
  });

  it('save-the-cat has 14 markers', () => {
    expect(BEAT_SHEETS['save-the-cat']).toHaveLength(14);
  });

  it('heros-journey has 12 markers', () => {
    expect(BEAT_SHEETS['heros-journey']).toHaveLength(12);
  });

  it('all markers have valid pct between 0 and 1', () => {
    for (const sheet of Object.values(BEAT_SHEETS)) {
      for (const marker of sheet) {
        expect(marker.pct).toBeGreaterThanOrEqual(0);
        expect(marker.pct).toBeLessThanOrEqual(1);
      }
    }
  });

  it('all markers have a label string', () => {
    for (const sheet of Object.values(BEAT_SHEETS)) {
      for (const marker of sheet) {
        expect(typeof marker.label).toBe('string');
        expect(marker.label.length).toBeGreaterThan(0);
      }
    }
  });
});
