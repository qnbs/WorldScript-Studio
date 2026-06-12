import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../../../features/proForge/types';
import {
  applyReviewEditsToSection,
  planAcceptedManuscriptEdits,
  validateProposedText,
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
    expect(result.invalid).toBe(0);
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

  it('replaces an empty section when a full-range edit with empty original is provided', () => {
    const result = applyReviewEditsToSection('', [
      item({
        id: 'empty-section',
        original: '',
        proposed: 'Once upon a time.',
        range: { start: 0, end: 0 },
      }),
    ]);
    expect(result.content).toBe('Once upon a time.');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips proposed text containing null bytes and counts it as invalid', () => {
    const content = 'The quick brown fox.';
    const result = applyReviewEditsToSection(content, [
      item({ original: 'quick', proposed: 'slow\0malicious' }),
    ]);
    expect(result.content).toBe(content);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.invalid).toBe(1);
  });

  it('skips proposed text containing disallowed control characters', () => {
    const content = 'The quick brown fox.';
    const result = applyReviewEditsToSection(content, [
      item({ original: 'quick', proposed: 'slow\u0001malicious' }),
      item({ original: 'brown', proposed: 'red\u007Ftail' }),
    ]);
    expect(result.content).toBe(content);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.invalid).toBe(2);
  });

  it('allows tab, newline, and carriage return in proposed text', () => {
    const content = 'Line one.';
    const result = applyReviewEditsToSection(content, [
      item({ original: 'Line one.', proposed: 'Line one.\n\tLine two.\r\n' }),
    ]);
    expect(result.applied).toBe(1);
    expect(result.content).toBe('Line one.\n\tLine two.\r\n');
    expect(result.invalid).toBe(0);
  });

  it('skips proposed text containing lone surrogates', () => {
    const content = 'The quick brown fox.';
    const result = applyReviewEditsToSection(content, [
      item({ original: 'quick', proposed: 'slow\uD800malicious' }),
    ]);
    expect(result.content).toBe(content);
    expect(result.applied).toBe(0);
    expect(result.invalid).toBe(1);
  });

  it('skips oversized proposed text', () => {
    const content = 'The quick brown fox.';
    const huge = 'x'.repeat(1_048_577);
    const result = applyReviewEditsToSection(content, [
      item({ original: 'quick', proposed: huge }),
    ]);
    expect(result.content).toBe(content);
    expect(result.applied).toBe(0);
    expect(result.invalid).toBe(1);
  });

  it('applies valid edits in a batch even when one edit is invalid', () => {
    const content = 'The quick brown fox.';
    const result = applyReviewEditsToSection(content, [
      item({ id: 'bad', original: 'quick', proposed: 'slow\0malicious' }),
      item({ id: 'good', original: 'brown', proposed: 'red' }),
    ]);
    expect(result.content).toBe('The quick red fox.');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.invalid).toBe(1);
  });
});

describe('validateProposedText', () => {
  it('accepts plain Unicode text', () => {
    expect(validateProposedText('Hello, world!')).toEqual({ ok: true, text: 'Hello, world!' });
  });

  it('rejects null bytes', () => {
    expect(validateProposedText('a\0b').ok).toBe(false);
  });

  it('rejects C0 control characters except tab/newline/cr', () => {
    expect(validateProposedText('a\x01b').ok).toBe(false);
    expect(validateProposedText('a\x08b').ok).toBe(false);
    expect(validateProposedText('a\x0Bb').ok).toBe(false);
    expect(validateProposedText('a\x7Fb').ok).toBe(false);
  });

  it('allows tab, newline, and carriage return', () => {
    expect(validateProposedText('a\tb').ok).toBe(true);
    expect(validateProposedText('a\nb').ok).toBe(true);
    expect(validateProposedText('a\rb').ok).toBe(true);
  });

  it('rejects lone surrogates', () => {
    expect(validateProposedText('a\uD800b').ok).toBe(false);
    expect(validateProposedText('a\uDFFFb').ok).toBe(false);
  });

  it('accepts valid surrogate pairs (real emoji)', () => {
    expect(validateProposedText('Hello 👋 world').ok).toBe(true);
  });
});

describe('planAcceptedManuscriptEdits', () => {
  const manuscript = [
    { id: 's1', content: 'The quick brown fox.' },
    { id: 's2', content: 'Jumped over the lazy dog.' },
  ];

  it('returns only sections that changed, with aggregate counts', () => {
    const { updates, applied, skipped, invalid } = planAcceptedManuscriptEdits(manuscript, [
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
    expect(invalid).toBe(0);
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

  it('aggregates invalid counts across sections', () => {
    const { applied, skipped, invalid } = planAcceptedManuscriptEdits(manuscript, [
      item({ id: 'a', sectionId: 's1', original: 'quick', proposed: 'slow\0bad' }),
      item({ id: 'b', sectionId: 's2', original: 'lazy', proposed: 'sleepy' }),
      item({ id: 'c', sectionId: 's1', original: 'fox', proposed: 'cat\x08bad' }),
    ]);
    expect(applied).toBe(1);
    expect(invalid).toBe(2);
    expect(skipped).toBe(2);
  });
});
