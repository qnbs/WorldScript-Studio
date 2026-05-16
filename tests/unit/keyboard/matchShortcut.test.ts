import { describe, expect, it } from 'vitest';
import {
  eventMatchesShortcutKeys,
  keyMatchesToken,
} from '../../../services/keyboard/matchShortcut';

// ---------------------------------------------------------------------------
// Helper: creates a minimal KeyboardEvent-like object
// ---------------------------------------------------------------------------
function makeEvent(overrides: Partial<KeyboardEventInit> & { code?: string } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: 'a',
    ...overrides,
  });
  // code is read-only on KeyboardEvent, but we can override via defineProperty for tests
  if (overrides.code !== undefined) {
    Object.defineProperty(e, 'code', { value: overrides.code, configurable: true });
  }
  return e;
}

// ---------------------------------------------------------------------------
// keyMatchesToken
// ---------------------------------------------------------------------------
describe('keyMatchesToken', () => {
  // Modifier tokens
  it('matches Ctrl when e.ctrlKey is true', () => {
    expect(keyMatchesToken(makeEvent({ ctrlKey: true }), 'Ctrl')).toBe(true);
  });
  it('does not match Ctrl when e.ctrlKey is false', () => {
    expect(keyMatchesToken(makeEvent({ ctrlKey: false }), 'Ctrl')).toBe(false);
  });
  it('matches Meta when e.metaKey is true', () => {
    expect(keyMatchesToken(makeEvent({ metaKey: true }), 'Meta')).toBe(true);
  });
  it('matches Shift when e.shiftKey is true', () => {
    expect(keyMatchesToken(makeEvent({ shiftKey: true }), 'Shift')).toBe(true);
  });
  it('matches Alt when e.altKey is true', () => {
    expect(keyMatchesToken(makeEvent({ altKey: true }), 'Alt')).toBe(true);
  });

  // Special key names
  it('matches Escape by e.key', () => {
    expect(keyMatchesToken(makeEvent({ key: 'Escape' }), 'Escape')).toBe(true);
  });
  it('matches Esc alias for Escape', () => {
    expect(keyMatchesToken(makeEvent({ key: 'Escape' }), 'Esc')).toBe(true);
  });
  it('matches Enter', () => {
    expect(keyMatchesToken(makeEvent({ key: 'Enter' }), 'Enter')).toBe(true);
  });
  it('matches Return alias for Enter', () => {
    expect(keyMatchesToken(makeEvent({ key: 'Enter' }), 'Return')).toBe(true);
  });
  it('matches Tab', () => {
    expect(keyMatchesToken(makeEvent({ key: 'Tab' }), 'Tab')).toBe(true);
  });
  it('matches Space by key == " "', () => {
    expect(keyMatchesToken(makeEvent({ key: ' ' }), 'Space')).toBe(true);
  });

  // Single character — case-insensitive
  it('matches single character key (lowercase match)', () => {
    expect(keyMatchesToken(makeEvent({ key: 'k' }), 'K')).toBe(true);
  });
  it('matches single character via e.code KeyS', () => {
    expect(keyMatchesToken(makeEvent({ key: 'S', code: 'KeyS' }), 's')).toBe(true);
  });

  // Multi-char fallback
  it('falls back to e.key.toLowerCase() for multi-char tokens', () => {
    expect(keyMatchesToken(makeEvent({ key: 'PageDown' }), 'pagedown')).toBe(true);
  });
  it('returns false when multi-char token does not match', () => {
    expect(keyMatchesToken(makeEvent({ key: 'a' }), 'pagedown')).toBe(false);
  });

  // Trims whitespace around tokens
  it('trims whitespace around the token', () => {
    expect(keyMatchesToken(makeEvent({ ctrlKey: true }), '  ctrl  ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// eventMatchesShortcutKeys
// ---------------------------------------------------------------------------
describe('eventMatchesShortcutKeys', () => {
  it('returns false for an empty keys array', () => {
    expect(eventMatchesShortcutKeys(makeEvent(), [])).toBe(false);
  });

  it('returns false when only modifier keys are specified (no non-modifier key)', () => {
    expect(eventMatchesShortcutKeys(makeEvent({ ctrlKey: true }), ['Ctrl'])).toBe(false);
  });

  it('matches Ctrl+S', () => {
    const e = makeEvent({ ctrlKey: true, key: 's' });
    expect(eventMatchesShortcutKeys(e, ['Ctrl', 'S'])).toBe(true);
  });

  it('does not match Ctrl+S when Shift is also pressed (unexpected modifier)', () => {
    const e = makeEvent({ ctrlKey: true, shiftKey: true, key: 's' });
    expect(eventMatchesShortcutKeys(e, ['Ctrl', 'S'])).toBe(false);
  });

  it('matches Ctrl+Shift+K', () => {
    const e = makeEvent({ ctrlKey: true, shiftKey: true, key: 'k' });
    expect(eventMatchesShortcutKeys(e, ['Ctrl', 'Shift', 'K'])).toBe(true);
  });

  it('does not match when expected modifier is missing', () => {
    const e = makeEvent({ key: 's' }); // no Ctrl
    expect(eventMatchesShortcutKeys(e, ['Ctrl', 'S'])).toBe(false);
  });

  it('does not match when the key character is wrong', () => {
    const e = makeEvent({ ctrlKey: true, key: 'x' });
    expect(eventMatchesShortcutKeys(e, ['Ctrl', 'S'])).toBe(false);
  });

  it('matches plain key (no modifiers) when no modifiers pressed', () => {
    const e = makeEvent({ key: 'Escape' });
    expect(eventMatchesShortcutKeys(e, ['Escape'])).toBe(true);
  });
});
