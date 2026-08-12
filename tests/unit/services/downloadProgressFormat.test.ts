import { describe, expect, it } from 'vitest';
import {
  formatMegabytes,
  formatMegabytesPerSecond,
} from '../../../services/downloadProgressFormat';

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

describe('formatMegabytesPerSecond', () => {
  it('formats a byte rate with one decimal', () => {
    expect(formatMegabytesPerSecond(3.2 * 1024 * 1024)).toBe('3.2');
  });

  it('handles zero bytes per second', () => {
    expect(formatMegabytesPerSecond(0)).toBe('0.0');
  });
});
