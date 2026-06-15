/**
 * Tests for services/commands/palettePreferences.ts
 * QNBS-v3: localStorage-backed preferences — covers load, save, recordRecent, togglePinned, isPinned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPinnedCommand,
  loadPalettePreferences,
  recordRecentCommand,
  savePalettePreferences,
  togglePinnedCommand,
} from '../../../services/commands/palettePreferences';

describe('palettePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('loadPalettePreferences', () => {
    it('returns empty defaults when nothing is stored', () => {
      const prefs = loadPalettePreferences();
      expect(prefs.recentIds).toEqual([]);
      expect(prefs.pinnedIds).toEqual([]);
    });

    it('returns stored data', () => {
      localStorage.setItem(
        'worldscript-palette-prefs-v1',
        JSON.stringify({ recentIds: ['a', 'b'], pinnedIds: ['c'] }),
      );
      const prefs = loadPalettePreferences();
      expect(prefs.recentIds).toEqual(['a', 'b']);
      expect(prefs.pinnedIds).toEqual(['c']);
    });

    it('returns defaults when JSON is malformed', () => {
      localStorage.setItem('worldscript-palette-prefs-v1', '{{{invalid}}}');
      const prefs = loadPalettePreferences();
      expect(prefs.recentIds).toEqual([]);
    });

    it('limits recentIds to 15', () => {
      const ids = Array.from({ length: 20 }, (_, i) => `cmd-${i}`);
      localStorage.setItem(
        'worldscript-palette-prefs-v1',
        JSON.stringify({ recentIds: ids, pinnedIds: [] }),
      );
      const prefs = loadPalettePreferences();
      expect(prefs.recentIds).toHaveLength(15);
    });
  });

  describe('savePalettePreferences', () => {
    it('persists data to localStorage', () => {
      savePalettePreferences({ recentIds: ['x'], pinnedIds: ['y'] });
      const raw = localStorage.getItem('worldscript-palette-prefs-v1');
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.recentIds).toEqual(['x']);
      expect(parsed.pinnedIds).toEqual(['y']);
    });

    it('truncates to 15 recent and 20 pinned on save', () => {
      const recent = Array.from({ length: 20 }, (_, i) => `r-${i}`);
      const pinned = Array.from({ length: 25 }, (_, i) => `p-${i}`);
      savePalettePreferences({ recentIds: recent, pinnedIds: pinned });
      const raw = localStorage.getItem('worldscript-palette-prefs-v1');
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.recentIds).toHaveLength(15);
      expect(parsed.pinnedIds).toHaveLength(20);
    });
  });

  describe('recordRecentCommand', () => {
    it('adds command to the front of recentIds', () => {
      recordRecentCommand('nav-dashboard');
      const prefs = loadPalettePreferences();
      expect(prefs.recentIds[0]).toBe('nav-dashboard');
    });

    it('deduplicates — moves existing to front', () => {
      recordRecentCommand('cmd-a');
      recordRecentCommand('cmd-b');
      recordRecentCommand('cmd-a'); // should move to front
      const prefs = loadPalettePreferences();
      expect(prefs.recentIds[0]).toBe('cmd-a');
      expect(prefs.recentIds.filter((x) => x === 'cmd-a')).toHaveLength(1);
    });
  });

  describe('togglePinnedCommand', () => {
    it('pins an unpinned command and returns true', () => {
      const result = togglePinnedCommand('cmd-x');
      expect(result).toBe(true);
      expect(loadPalettePreferences().pinnedIds).toContain('cmd-x');
    });

    it('unpins a pinned command and returns false', () => {
      togglePinnedCommand('cmd-x'); // pin
      const result = togglePinnedCommand('cmd-x'); // unpin
      expect(result).toBe(false);
      expect(loadPalettePreferences().pinnedIds).not.toContain('cmd-x');
    });
  });

  describe('isPinnedCommand', () => {
    it('returns false for unpinned command', () => {
      expect(isPinnedCommand('cmd-z')).toBe(false);
    });

    it('returns true after pinning', () => {
      togglePinnedCommand('cmd-z');
      expect(isPinnedCommand('cmd-z')).toBe(true);
    });

    it('returns false after unpinning', () => {
      togglePinnedCommand('cmd-z');
      togglePinnedCommand('cmd-z');
      expect(isPinnedCommand('cmd-z')).toBe(false);
    });
  });
});
