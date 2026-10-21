import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cssColorToHex,
  useResolvedThemeTokens,
} from '../../../components/settings/useResolvedThemeTokens';

describe('cssColorToHex (#818)', () => {
  it.each([
    ['#AABBCC', '#aabbcc'],
    ['#abc', '#aabbcc'],
    ['rgb(10, 20, 30)', '#0a141e'],
    ['rgba(1, 2, 3, 0.5)', '#010203'],
    ['rgb(10 20 30 / 50%)', '#0a141e'],
    ['color(srgb 0.5 0.25 1)', '#8040ff'],
    ['oklch(0.7 0.1 200)', ''],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(cssColorToHex(input)).toBe(expected);
  });
});

describe('useResolvedThemeTokens (#818)', () => {
  afterEach(() => {
    document.body.style.removeProperty('--sc-surface-base');
  });

  it('re-reads the tokens one frame after the theme version changes', async () => {
    document.body.style.setProperty('--sc-surface-base', '#111111');
    const tokens = ['--sc-surface-base'] as const;
    const { result, rerender } = renderHook(({ v }) => useResolvedThemeTokens(tokens, v), {
      initialProps: { v: 'dark' },
    });
    expect(result.current['--sc-surface-base']).toBe('#111111');
    document.body.style.setProperty('--sc-surface-base', '#fafafa');
    rerender({ v: 'light' });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(result.current['--sc-surface-base']).toBe('#fafafa');
  });
});
