import type { KeyboardShortcut } from '../../types';

const MOD_ORDER = ['Meta', 'Ctrl', 'Shift', 'Alt'];

/** Einheitliche Darstellung für Konfliktvergleich. */
export function serializeShortcutChord(keys: string[]): string {
  const mods = keys
    .filter((k) => MOD_ORDER.includes(k))
    .sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  const rest = keys
    .filter((k) => !MOD_ORDER.includes(k))
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => k.toLowerCase());
  return [...mods, ...rest].join('+');
}

/** Gibt Chord-Signaturen zurück, denen mehr als eine Shortcut-ID zugeordnet ist. */
export function getShortcutConflictSignatures(shortcuts: KeyboardShortcut[]): string[] {
  const byChord = new Map<string, string[]>();
  for (const s of shortcuts) {
    const sig = serializeShortcutChord(s.keys);
    const arr = byChord.get(sig) ?? [];
    arr.push(s.id);
    byChord.set(sig, arr);
  }
  return [...byChord.entries()].filter(([, ids]) => ids.length > 1).map(([sig]) => sig);
}
