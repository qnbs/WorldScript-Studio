import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatContrastRatio } from '../../../components/settings/ThemeCustomizationCard';
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

describe('formatContrastRatio (#818)', () => {
  it('rounds down so a failing ratio never reads as 4.5', () => {
    expect(formatContrastRatio(4.48)).toBe('4.4');
    expect(formatContrastRatio(3.999)).toBe('3.9');
    expect(formatContrastRatio(2)).toBe('2.0');
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

  it('re-reads the tokens when the system color scheme changes (Auto theme)', async () => {
    const listeners: Array<() => void> = [];
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    document.body.style.setProperty('--sc-surface-base', '#111111');
    const tokens = ['--sc-surface-base'] as const;
    const { result } = renderHook(() => useResolvedThemeTokens(tokens, 'auto'));
    document.body.style.setProperty('--sc-surface-base', '#eeeeee');
    await act(async () => {
      for (const listener of listeners) listener();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(result.current['--sc-surface-base']).toBe('#eeeeee');
    window.matchMedia = original;
  });
});
