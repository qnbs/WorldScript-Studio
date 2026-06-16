import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPinnedCommand,
  loadPalettePreferences,
  recordRecentCommand,
  savePalettePreferences,
  togglePinnedCommand,
} from '../../services/commands/palettePreferences';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('loadPalettePreferences', () => {
  it('returns empty arrays when nothing stored', () => {
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual([]);
    expect(prefs.pinnedIds).toEqual([]);
  });

  it('parses stored preferences', () => {
    localStorage.setItem(
      'worldscript-palette-prefs-v1',
      JSON.stringify({ recentIds: ['a', 'b'], pinnedIds: ['c'] }),
    );
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual(['a', 'b']);
    expect(prefs.pinnedIds).toEqual(['c']);
  });

  it('returns defaults when JSON is invalid', () => {
    localStorage.setItem('worldscript-palette-prefs-v1', '{invalid json}');
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual([]);
  });

  it('returns defaults when stored arrays are missing', () => {
    localStorage.setItem('worldscript-palette-prefs-v1', JSON.stringify({}));
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds).toEqual([]);
    expect(prefs.pinnedIds).toEqual([]);
  });
});

describe('savePalettePreferences', () => {
  it('saves preferences to localStorage', () => {
    savePalettePreferences({ recentIds: ['x'], pinnedIds: ['y'] });
    const raw = localStorage.getItem('worldscript-palette-prefs-v1');
    expect(JSON.parse(raw!).recentIds).toEqual(['x']);
    expect(JSON.parse(raw!).pinnedIds).toEqual(['y']);
  });

  it('trims recentIds to 15 items', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    savePalettePreferences({ recentIds: ids, pinnedIds: [] });
    const prefs = loadPalettePreferences();
    expect(prefs.recentIds.length).toBe(15);
  });

  it('trims pinnedIds to 20 items', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `pin-${i}`);
    savePalettePreferences({ recentIds: [], pinnedIds: ids });
    const prefs = loadPalettePreferences();
    expect(prefs.pinnedIds.length).toBe(20);
  });
});

describe('recordRecentCommand', () => {
  it('adds a command to the front', () => {
    recordRecentCommand('cmd1');
    expect(loadPalettePreferences().recentIds[0]).toBe('cmd1');
  });

  it('deduplicates: moves existing id to front', () => {
    savePalettePreferences({ recentIds: ['a', 'b', 'c'], pinnedIds: [] });
    recordRecentCommand('b');
    expect(loadPalettePreferences().recentIds[0]).toBe('b');
    expect(loadPalettePreferences().recentIds.filter((x) => x === 'b').length).toBe(1);
  });
});

describe('togglePinnedCommand', () => {
  it('pins an unpinned command and returns true', () => {
    const result = togglePinnedCommand('my-cmd');
    expect(result).toBe(true);
    expect(loadPalettePreferences().pinnedIds).toContain('my-cmd');
  });

  it('unpins a pinned command and returns false', () => {
    savePalettePreferences({ recentIds: [], pinnedIds: ['my-cmd'] });
    const result = togglePinnedCommand('my-cmd');
    expect(result).toBe(false);
    expect(loadPalettePreferences().pinnedIds).not.toContain('my-cmd');
  });
});

describe('isPinnedCommand', () => {
  it('returns false when command is not pinned', () => {
    expect(isPinnedCommand('nope')).toBe(false);
  });

  it('returns true when command is pinned', () => {
    savePalettePreferences({ recentIds: [], pinnedIds: ['yep'] });
    expect(isPinnedCommand('yep')).toBe(true);
  });
});
