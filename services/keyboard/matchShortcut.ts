/**
 * Prüft ob ein KeyboardEvent zu einer gespeicherten Shortcut-Liste passt.
 * Erwartete Modifier-Strings: Ctrl, Meta, Shift, Alt.
 */

export function keyMatchesToken(e: KeyboardEvent, token: string): boolean {
  const t = token.trim();
  const lower = t.toLowerCase();

  if (lower === 'ctrl') return e.ctrlKey;
  if (lower === 'meta') return e.metaKey;
  if (lower === 'shift') return e.shiftKey;
  if (lower === 'alt') return e.altKey;

  if (lower === 'escape' || lower === 'esc') return e.key === 'Escape';
  if (lower === 'enter' || lower === 'return') return e.key === 'Enter';
  if (lower === 'tab') return e.key === 'Tab';
  if (lower === 'space') return e.key === ' ';

  if (t.length === 1 || lower.length === 1) {
    const ch = lower;
    return e.key.toLowerCase() === ch || e.code === `Key${ch.toUpperCase()}`;
  }

  return e.key.toLowerCase() === lower;
}

export function eventMatchesShortcutKeys(e: KeyboardEvent, keys: string[]): boolean {
  if (!keys.length) return false;

  const modifiers = new Set(keys.filter((k) => ['Ctrl', 'Meta', 'Shift', 'Alt'].includes(k)));
  const nonMods = keys.filter((k) => !['Ctrl', 'Meta', 'Shift', 'Alt'].includes(k));

  const expectCtrl = modifiers.has('Ctrl');
  const expectMeta = modifiers.has('Meta');
  const expectShift = modifiers.has('Shift');
  const expectAlt = modifiers.has('Alt');

  if (expectCtrl !== e.ctrlKey) return false;
  if (expectMeta !== e.metaKey) return false;
  if (expectShift !== e.shiftKey) return false;
  if (expectAlt !== e.altKey) return false;

  if (nonMods.length === 0) return false;

  return nonMods.every((nm) => keyMatchesToken(e, nm));
}
