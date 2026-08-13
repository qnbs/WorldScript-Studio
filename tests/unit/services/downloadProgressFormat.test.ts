import { describe, expect, it } from 'vitest';
import { formatMegabytes, megabytesPerSecond } from '../../../services/downloadProgressFormat';

describe('formatMegabytes', () => {
  it('formats bytes as whole megabytes', () => {
    expect(formatMegabytes(700 * 1024 * 1024)).toBe('700');
  });

  it('rounds to the nearest whole megabyte', () => {
    expect(formatMegabytes(1.6 * 1024 * 1024)).toBe('2');
  });

  it('handles zero bytes', () => {
    expect(formatMegabytes(0)).toBe('0');
  });
});

describe('megabytesPerSecond', () => {
  it('converts a byte rate to megabytes, rounded to one decimal', () => {
    expect(megabytesPerSecond(3.2 * 1024 * 1024)).toBe(3.2);
  });

  it('handles zero bytes per second', () => {
    expect(megabytesPerSecond(0)).toBe(0);
  });

  // QNBS-v3 (#333/CodeRabbit): the caller — not this function — is responsible for locale-aware decimal formatting.
  it('returns a plain number, not a locale-formatted string', () => {
    expect(typeof megabytesPerSecond(1024 * 1024)).toBe('number');
  });
});
