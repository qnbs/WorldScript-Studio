import { describe, expect, it } from 'vitest';
import {
  getShortcutConflictSignatures,
  serializeShortcutChord,
} from '../../../services/keyboard/shortcutConflicts';
import type { KeyboardShortcut } from '../../../types';

// ---------------------------------------------------------------------------
// serializeShortcutChord
// ---------------------------------------------------------------------------
describe('serializeShortcutChord', () => {
  it('serializes a simple key without modifiers', () => {
    expect(serializeShortcutChord(['K'])).toBe('k');
  });

  it('puts modifiers before the key in MOD_ORDER order', () => {
    expect(serializeShortcutChord(['Ctrl', 'S'])).toBe('Ctrl+s');
  });

  it('sorts multiple modifiers in Meta > Ctrl > Shift > Alt order', () => {
    expect(serializeShortcutChord(['Shift', 'Meta', 'K'])).toBe('Meta+Shift+k');
  });

  it('lowercases the non-modifier key', () => {
    expect(serializeShortcutChord(['Ctrl', 'Shift', 'Z'])).toBe('Ctrl+Shift+z');
  });

  it('handles Ctrl+Alt+Delete style', () => {
    const sig = serializeShortcutChord(['Alt', 'Ctrl', 'Delete']);
    expect(sig).toBe('Ctrl+Alt+delete');
  });

  it('returns empty string for an empty array', () => {
    expect(serializeShortcutChord([])).toBe('');
  });

  it('trims whitespace from non-modifier keys', () => {
    expect(serializeShortcutChord(['Ctrl', '  s  '])).toBe('Ctrl+s');
  });

  it('filters out blank non-modifier keys', () => {
    expect(serializeShortcutChord(['Ctrl', ''])).toBe('Ctrl');
  });
});

// ---------------------------------------------------------------------------
// getShortcutConflictSignatures
// ---------------------------------------------------------------------------

function makeShortcut(id: string, keys: string[]): KeyboardShortcut {
  return {
    id,
    action: id as KeyboardShortcut['action'],
    key: keys.join('+'),
    ctrlOrCmd: false,
    shift: false,
    alt: false,
    keys,
  } as unknown as KeyboardShortcut;
}

describe('getShortcutConflictSignatures', () => {
  it('returns empty array when there are no shortcuts', () => {
    expect(getShortcutConflictSignatures([])).toEqual([]);
  });

  it('returns empty array when there are no conflicts', () => {
    const shortcuts = [makeShortcut('s1', ['Ctrl', 'S']), makeShortcut('s2', ['Ctrl', 'Z'])];
    expect(getShortcutConflictSignatures(shortcuts)).toEqual([]);
  });

  it('returns the conflicting chord signature when two shortcuts share the same keys', () => {
    const shortcuts = [
      makeShortcut('save', ['Ctrl', 'S']),
      makeShortcut('duplicate-save', ['Ctrl', 'S']),
    ];
    const conflicts = getShortcutConflictSignatures(shortcuts);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toBe('Ctrl+s');
  });

  it('returns multiple conflict signatures when there are multiple conflicts', () => {
    const shortcuts = [
      makeShortcut('a1', ['Ctrl', 'S']),
      makeShortcut('a2', ['Ctrl', 'S']),
      makeShortcut('b1', ['Ctrl', 'Z']),
      makeShortcut('b2', ['Ctrl', 'Z']),
    ];
    const conflicts = getShortcutConflictSignatures(shortcuts);
    expect(conflicts).toHaveLength(2);
    expect(conflicts).toContain('Ctrl+s');
    expect(conflicts).toContain('Ctrl+z');
  });

  it('normalizes chord order before comparing', () => {
    // Both should produce the same chord signature
    const shortcuts = [
      makeShortcut('s1', ['Ctrl', 'Shift', 'K']),
      makeShortcut('s2', ['Shift', 'Ctrl', 'K']), // different order, same chord
    ];
    const conflicts = getShortcutConflictSignatures(shortcuts);
    expect(conflicts).toHaveLength(1);
  });
});
