/**
 * Tests for services/commands/wordCountApprox.ts
 * QNBS-v3: Pure function; tests word count calculation with various inputs.
 */

import { describe, expect, it } from 'vitest';
import { approximateManuscriptWordCount } from '../../../services/commands/wordCountApprox';

describe('approximateManuscriptWordCount', () => {
  it('returns 0 for undefined data', () => {
    expect(approximateManuscriptWordCount(undefined)).toBe(0);
  });

  it('returns 0 for empty manuscript', () => {
    expect(approximateManuscriptWordCount({ manuscript: [] } as never)).toBe(0);
  });

  it('counts words in plain text sections', () => {
    const data = {
      manuscript: [{ content: 'Hello world foo', id: 's1' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(3);
  });

  it('strips HTML tags before counting', () => {
    const data = {
      manuscript: [{ content: '<p>Hello <strong>world</strong></p>', id: 's1' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(2);
  });

  it('sums word counts across multiple sections', () => {
    const data = {
      manuscript: [
        { content: 'one two', id: 's1' },
        { content: 'three four five', id: 's2' },
      ],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(5);
  });

  it('handles section with empty content', () => {
    const data = {
      manuscript: [
        { content: '', id: 's1' },
        { content: 'word', id: 's2' },
      ],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(1);
  });

  it('handles section with undefined content', () => {
    const data = {
      manuscript: [
        { content: undefined, id: 's1' },
        { content: 'test word', id: 's2' },
      ],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(2);
  });

  it('handles whitespace-only content', () => {
    const data = {
      manuscript: [{ content: '   \n\t   ', id: 's1' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(0);
  });
});
