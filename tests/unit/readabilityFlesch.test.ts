import { describe, expect, it } from 'vitest';
import { computeReadabilitySnapshot, estimateSyllables } from '../../services/readabilityFlesch';

describe('readabilityFlesch', () => {
  it('estimateSyllables handles basic English', () => {
    expect(estimateSyllables('story')).toBeGreaterThanOrEqual(1);
    expect(estimateSyllables('beautiful')).toBeGreaterThanOrEqual(2);
  });

  it('returns null score for very short texts', () => {
    const r = computeReadabilitySnapshot('hello world');
    expect(r.score).toBeNull();
    expect(r.words).toBe(2);
  });

  it('returns bounded score for longer text', () => {
    const filler =
      'The quick brown fox jumps over the lazy dog. '.repeat(12) +
      'Writing stays readable when sentences stay crisp and varied.';
    const r = computeReadabilitySnapshot(filler);
    expect(r.score).not.toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
