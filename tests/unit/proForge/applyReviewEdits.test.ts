import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../../../features/proForge/types';
import {
  applyReviewEditsToSection,
  planAcceptedManuscriptEdits,
} from '../../../services/proForge/applyReviewEdits';

// QNBS-v3: Minimal ReviewItem factory — only the fields the applier reads.
function item(partial: Partial<ReviewItem>): ReviewItem {
  return {
    id: partial.id ?? 'r1',
    stage: 'lineProse',
    type: 'proseEdit',
    severity: 'info',
    description: 'd',
    confidence: 0.9,
    status: 'accepted',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('applyReviewEditsToSection', () => {
  it('applies a single range-based edit verified against original', () => {
    const content = 'The quick brown fox.';
    const result = applyReviewEditsToSection(content, [
      item({ range: { start: 4, end: 9 }, original: 'quick', proposed: 'slow' }),
    ]);
    expect(result.content).toBe('The slow brown fox.');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('applies multiple edits back-to-front so offsets stay valid', () => {
    const content = 'aaa bbb ccc';
    const result = applyReviewEditsToSection(content, [
      item({ id: '1', range: { start: 0, end: 3 }, original: 'aaa', proposed: 'X' }),
      item({ id: '2', range: { start: 8, end: 11 }, original: 'ccc', proposed: 'YYYYY' }),
    ]);
    expect(result.content).toBe('X bbb YYYYY');
    expect(result.applied).toBe(2);
  });

  it('falls back to text match when the offset is stale', () => {
    const content = 'hello wonderful world';
    // Range points at the wrong place; original text still locatable.
    const result = applyReviewEditsToSection(content, [
      item({ range: { start: 0, end: 5 }, original: 'wonderful', proposed: 'cruel' }),
    ]);
    expect(result.content).toBe('hello cruel world');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips an edit whose original text cannot be found', () => {
    const content = 'nothing to see here';
    const result = applyReviewEditsToSection(content, [
      item({ original: 'absent phrase', proposed: 'x' }),
    ]);
    expect(result.content).toBe(content);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('ignores advisory items with no proposed replacement (not counted as skipped)', () => {
    const content = 'unchanged';
    const result = applyReviewEditsToSection(content, [
      item({ type: 'pacingIssue', description: 'advisory only' }),
    ]);
    expect(result.content).toBe('unchanged');
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('drops overlapping edits rather than corrupting the text', () => {
    const content = 'abcdef';
    const result = applyReviewEditsToSection(content, [
      item({ id: '1', range: { start: 1, end: 4 }, proposed: 'XX' }),
      item({ id: '2', range: { start: 2, end: 5 }, proposed: 'YY' }),
    ]);
    // Right-most (start=2) applies first; the start=1 edit overlaps it and is skipped.
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('anchors a stale-offset edit to the occurrence nearest the original range', () => {
    const content = 'cat dog cat dog cat';
    // 'cat' occurs at offsets 0, 8, 16; the stale range points near the middle one.
    const result = applyReviewEditsToSection(content, [
      item({ range: { start: 7, end: 10 }, original: 'cat', proposed: 'COW' }),
    ]);
    expect(result.content).toBe('cat dog COW dog cat');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('applies duplicate-phrase edits to distinct occurrences (no double-anchoring)', () => {
    const content = 'go go go';
    const result = applyReviewEditsToSection(content, [
      item({ id: '1', original: 'go', proposed: 'A' }),
      item({ id: '2', original: 'go', proposed: 'B' }),
    ]);
    expect(result.applied).toBe(2);
    expect(result.content).toBe('A B go');
  });
});

describe('planAcceptedManuscriptEdits', () => {
  const manuscript = [
    { id: 's1', content: 'The quick brown fox.' },
    { id: 's2', content: 'Jumped over the lazy dog.' },
  ];

  it('returns only sections that changed, with aggregate counts', () => {
    const { updates, applied, skipped } = planAcceptedManuscriptEdits(manuscript, [
      item({
        id: 'a',
        sectionId: 's1',
        range: { start: 4, end: 9 },
        original: 'quick',
        proposed: 'sly',
      }),
      item({ id: 'b', sectionId: 's2', original: 'lazy', proposed: 'sleepy' }),
    ]);
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => u.id === 's1')?.content).toBe('The sly brown fox.');
    expect(updates.find((u) => u.id === 's2')?.content).toBe('Jumped over the sleepy dog.');
    expect(applied).toBe(2);
    expect(skipped).toBe(0);
  });

  it('counts edits for a deleted section as skipped', () => {
    const { updates, applied, skipped } = planAcceptedManuscriptEdits(manuscript, [
      item({ id: 'a', sectionId: 'ghost', original: 'x', proposed: 'y' }),
    ]);
    expect(updates).toHaveLength(0);
    expect(applied).toBe(0);
    expect(skipped).toBe(1);
  });

  it('ignores items without a sectionId or proposed text', () => {
    const { updates } = planAcceptedManuscriptEdits(manuscript, [
      item({ id: 'a', proposed: 'orphan' }),
      item({ id: 'b', sectionId: 's1', type: 'pacingIssue' }),
    ]);
    expect(updates).toHaveLength(0);
  });
});
