import { beforeEach, describe, expect, it } from 'vitest';
import {
  isPinnedCommand,
  loadPalettePreferences,
  recordRecentCommand,
  savePalettePreferences,
  togglePinnedCommand,
} from '../../../services/commands/palettePreferences';

const STORAGE_KEY = 'worldscript-palette-prefs-v1';

beforeEach(() => {
  localStorage.clear();
});

describe('loadPalettePreferences', () => {
  it('returns default empty arrays when localStorage is empty', () => {
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual([]);
    expect(prefs.pinnedIds).toEqual([]);
  });

  it('parses stored JSON correctly', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recentIds: ['a', 'b'], pinnedIds: ['c'] }));
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual(['a', 'b']);
    expect(prefs.pinnedIds).toEqual(['c']);
  });

  it('returns defaults on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json}');
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual([]);
    expect(prefs.pinnedIds).toEqual([]);
  });

  it('caps recentIds at MAX_RECENT=15 on load', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `cmd-${i}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recentIds: ids, pinnedIds: [] }));
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds.length).toBe(15);
  });

  it('caps pinnedIds at MAX_PINNED=20 on load', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `pin-${i}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recentIds: [], pinnedIds: ids }));
    const prefs = loadPalettePreferences();
    expect(prefs.pinnedIds.length).toBe(20);
  });

  it('falls back to empty array when recentIds is not an array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recentIds: 'bad', pinnedIds: [] }));
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual([]);
  });

  it('falls back to empty array when pinnedIds is not an array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recentIds: [], pinnedIds: null }));
    const prefs = loadPalettePreferences();
    expect(prefs.pinnedIds).toEqual([]);
  });
});

describe('savePalettePreferences', () => {
  it('writes correct JSON to localStorage', () => {
    savePalettePreferences({ recentIds: ['x'], pinnedIds: ['y'] });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.recentIds).toEqual(['x']);
    expect(parsed.pinnedIds).toEqual(['y']);
  });

  it('slices recentIds to MAX_RECENT=15 on save', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `r${i}`);
    savePalettePreferences({ recentIds: ids, pinnedIds: [] });
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.recentIds.length).toBe(15);
  });

  it('slices pinnedIds to MAX_PINNED=20 on save', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `p${i}`);
    savePalettePreferences({ recentIds: [], pinnedIds: ids });
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.pinnedIds.length).toBe(20);
  });
});

describe('recordRecentCommand', () => {
  it('adds a new command to the front of recentIds', () => {
    recordRecentCommand('nav-dashboard');
    expect(loadPalettePreferences().recentIds[0]).toBe('nav-dashboard');
  });

  it('deduplicates by moving existing id to front', () => {
    savePalettePreferences({ recentIds: ['a', 'b', 'c'], pinnedIds: [] });
    recordRecentCommand('b');
    expect(loadPalettePreferences().recentIds).toEqual(['b', 'a', 'c']);
  });

  it('prepends to existing list', () => {
    savePalettePreferences({ recentIds: ['a'], pinnedIds: [] });
    recordRecentCommand('z');
    expect(loadPalettePreferences().recentIds[0]).toBe('z');
  });

  it('enforces MAX_RECENT=15 limit', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `cmd-${i}`);
    savePalettePreferences({ recentIds: ids, pinnedIds: [] });
    recordRecentCommand('new-cmd');
    expect(loadPalettePreferences().recentIds.length).toBe(15);
    expect(loadPalettePreferences().recentIds[0]).toBe('new-cmd');
  });

  it('does not duplicate when same command recorded twice', () => {
    recordRecentCommand('x');
    recordRecentCommand('x');
    expect(loadPalettePreferences().recentIds.filter((id) => id === 'x').length).toBe(1);
  });
});

describe('togglePinnedCommand', () => {
  it('returns true and adds id when not pinned', () => {
    const result = togglePinnedCommand('nav-writer');
    expect(result).toBe(true);
    expect(loadPalettePreferences().pinnedIds).toContain('nav-writer');
  });

  it('returns false and removes id when already pinned', () => {
    savePalettePreferences({ recentIds: [], pinnedIds: ['nav-writer'] });
    const result = togglePinnedCommand('nav-writer');
    expect(result).toBe(false);
    expect(loadPalettePreferences().pinnedIds).not.toContain('nav-writer');
  });

  it('enforces MAX_PINNED=20 limit when adding', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `pin-${i}`);
    savePalettePreferences({ recentIds: [], pinnedIds: ids });
    togglePinnedCommand('overflow-cmd');
    expect(loadPalettePreferences().pinnedIds.length).toBe(20);
  });

  it('does not change other preferences when toggling', () => {
    savePalettePreferences({ recentIds: ['recent-a'], pinnedIds: [] });
    togglePinnedCommand('some-cmd');
    expect(loadPalettePreferences().recentIds).toEqual(['recent-a']);
  });
});

describe('isPinnedCommand', () => {
  it('returns true when id is pinned', () => {
    savePalettePreferences({ recentIds: [], pinnedIds: ['nav-dashboard'] });
    expect(isPinnedCommand('nav-dashboard')).toBe(true);
  });

  it('returns false when id is not pinned', () => {
    expect(isPinnedCommand('non-existent')).toBe(false);
  });

  it('returns false when localStorage is empty', () => {
    expect(isPinnedCommand('anything')).toBe(false);
  });
});
