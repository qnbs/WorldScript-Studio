import { useEffect, useRef } from 'react';
import type { ShortcutRuntimeApi } from '../services/keyboard/shortcutActions';
import {
  findMatchingShortcutAction,
  performShortcutAction,
} from '../services/keyboard/shortcutActions';
import type { KeyboardShortcut } from '../types';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

interface Params {
  shortcuts: KeyboardShortcut[];
  api: ShortcutRuntimeApi;
  /** Wenn true: keine globalen Shortcuts (z. B. Modalfokus wird separat behandelt). */
  disabled?: boolean;
}

/**
 * Wertet settings.keyboardShortcuts aus; verhindert Defaults im Browser (preventDefault).
 */
export function useGlobalKeyboardShortcuts({ shortcuts, api, disabled }: Params): void {
  const apiRef = useRef(api);
  apiRef.current = api;
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (disabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const action = findMatchingShortcutAction(e, shortcutsRef.current);
      if (!action) {
        return;
      }

      const inField = isEditableTarget(e.target);
      if (inField && action !== 'openCommandPalette') {
        return;
      }

      e.preventDefault();
      void performShortcutAction(action, apiRef.current);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [disabled]);
}
