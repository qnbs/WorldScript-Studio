import { describe, expect, it } from 'vitest';
import {
  getDefaultKeyboardShortcuts,
  SHORTCUT_ACTION_REGISTRY,
} from '../../features/settings/keyboardShortcutsDefaults';

describe('getDefaultKeyboardShortcuts', () => {
  it('returns an array of keyboard shortcuts', () => {
    const shortcuts = getDefaultKeyboardShortcuts();
    expect(Array.isArray(shortcuts)).toBe(true);
    expect(shortcuts.length).toBeGreaterThan(0);
  });

  it('each shortcut has id, keys, and action', () => {
    const shortcuts = getDefaultKeyboardShortcuts();
    shortcuts.forEach((s) => {
      expect(typeof s.id).toBe('string');
      expect(Array.isArray(s.keys)).toBe(true);
      expect(typeof s.action).toBe('string');
    });
  });

  it('includes open-command-palette shortcut', () => {
    const shortcuts = getDefaultKeyboardShortcuts();
    const palette = shortcuts.find((s) => s.id === 'open-command-palette');
    expect(palette).toBeDefined();
    expect(palette?.action).toBe('openCommandPalette');
  });

  it('includes save shortcut', () => {
    const shortcuts = getDefaultKeyboardShortcuts();
    const save = shortcuts.find((s) => s.id === 'save');
    expect(save).toBeDefined();
    expect(save?.action).toBe('save');
  });

  it('uses Ctrl as modifier on non-Apple platforms (jsdom default)', () => {
    // jsdom navigator.userAgent is a Chrome-like UA, not Apple
    const shortcuts = getDefaultKeyboardShortcuts();
    shortcuts.forEach((s) => {
      expect(s.keys[0]).toMatch(/Ctrl|Meta/);
    });
  });
});

describe('SHORTCUT_ACTION_REGISTRY', () => {
  it('contains entries for all expected actions', () => {
    const actions = SHORTCUT_ACTION_REGISTRY.map((r) => r.action);
    expect(actions).toContain('openCommandPalette');
    expect(actions).toContain('save');
    expect(actions).toContain('newSection');
    expect(actions).toContain('search');
    expect(actions).toContain('export');
    expect(actions).toContain('toggleTheme');
  });

  it('each entry has action, labelKey, and defaultKeys', () => {
    SHORTCUT_ACTION_REGISTRY.forEach((r) => {
      expect(typeof r.action).toBe('string');
      expect(typeof r.labelKey).toBe('string');
      expect(Array.isArray(r.defaultKeys)).toBe(true);
    });
  });

  it('all labelKeys follow settings.shortcuts.* pattern', () => {
    SHORTCUT_ACTION_REGISTRY.forEach((r) => {
      expect(r.labelKey).toMatch(/^settings\.shortcuts\./);
    });
  });
});
