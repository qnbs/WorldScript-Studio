import type { KeyboardShortcut } from '../../types';

export function getDefaultKeyboardShortcuts(): KeyboardShortcut[] {
  const isApple =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.vendor || '');

  const mod = isApple ? 'Meta' : 'Ctrl';

  return [
    { id: 'open-command-palette', keys: [mod, 'K'], action: 'openCommandPalette' },
    { id: 'save', keys: [mod, 'S'], action: 'save' },
    { id: 'new-section', keys: [mod, 'N'], action: 'newSection' },
    { id: 'search', keys: [mod, 'F'], action: 'search' },
    { id: 'export', keys: [mod, 'E'], action: 'export' },
    { id: 'toggle-theme', keys: [mod, 'Shift', 'L'], action: 'toggleTheme' },
  ];
}

/** Alle Aktionen, die der Nutzer in den Einstellungen binden kann (Reihenfolge = UI). */
export const SHORTCUT_ACTION_REGISTRY: {
  action: string;
  labelKey: string;
  defaultKeys: string[];
}[] = [
  {
    action: 'openCommandPalette',
    labelKey: 'settings.shortcuts.openCommandPalette',
    defaultKeys: ['Ctrl', 'K'],
  },
  { action: 'save', labelKey: 'settings.shortcuts.saveProject', defaultKeys: ['Ctrl', 'S'] },
  { action: 'newSection', labelKey: 'settings.shortcuts.newSection', defaultKeys: ['Ctrl', 'N'] },
  { action: 'search', labelKey: 'settings.shortcuts.search', defaultKeys: ['Ctrl', 'F'] },
  { action: 'export', labelKey: 'settings.shortcuts.export', defaultKeys: ['Ctrl', 'E'] },
  {
    action: 'toggleTheme',
    labelKey: 'settings.shortcuts.toggleTheme',
    defaultKeys: ['Ctrl', 'Shift', 'L'],
  },
];
