/**
 * Tests for services/commands/effectiveTheme.ts
 * QNBS-v3: Pure function; tests theme resolution including auto/system-pref fallback.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEffectiveTheme } from '../../../services/commands/effectiveTheme';

describe('getEffectiveTheme', () => {
  it('returns "dark" for dark theme', () => {
    expect(getEffectiveTheme('dark')).toBe('dark');
  });

  it('returns "light" for light theme', () => {
    expect(getEffectiveTheme('light')).toBe('light');
  });

  describe('auto/system theme', () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', { value: originalMatchMedia, writable: true });
    });

    it('returns "dark" for auto theme when system prefers dark', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockReturnValue({ matches: true }),
      });
      expect(getEffectiveTheme('auto')).toBe('dark');
    });

    it('returns "light" for auto theme when system prefers light', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockReturnValue({ matches: false }),
      });
      expect(getEffectiveTheme('auto')).toBe('light');
    });

    it('returns "dark" as fallback for sepia theme without matchMedia', () => {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined });
      expect(getEffectiveTheme('sepia')).toBe('dark');
    });
  });
});
