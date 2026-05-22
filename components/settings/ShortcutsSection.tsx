import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { SHORTCUT_ACTION_REGISTRY } from '../../features/settings/keyboardShortcutsDefaults';
import { settingsActions } from '../../features/settings/settingsSlice';
import {
  getShortcutConflictSignatures,
  serializeShortcutChord,
} from '../../services/keyboard/shortcutConflicts';
import type { KeyboardShortcut } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';

function formatKeysForDisplay(keys: string[]): string {
  const isApple =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || '');
  return keys.join(isApple ? ' · ' : ' + ');
}

export const ShortcutsSection: FC = () => {
  const { t, settings } = useSettingsViewContext();
  const dispatch = useAppDispatch();
  const shortcuts = settings.keyboardShortcuts;

  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  const conflicts = useMemo(() => getShortcutConflictSignatures(shortcuts), [shortcuts]);

  const rows = useMemo(() => {
    return SHORTCUT_ACTION_REGISTRY.map((def) => {
      const existing = shortcuts.find((s) => s.action === def.action);
      return {
        def,
        existing:
          existing ??
          ({
            id: `shortcut-${def.action}`,
            keys: def.defaultKeys,
            action: def.action,
          } as KeyboardShortcut),
      };
    });
  }, [shortcuts]);

  const replaceShortcut = useCallback(
    (action: string, keys: string[]) => {
      const next = [...shortcuts];
      const idx = next.findIndex((s) => s.action === action);
      const stableId = idx >= 0 ? next[idx]?.id : `shortcut-${action}`;
      const entry: KeyboardShortcut = {
        id: stableId ?? `shortcut-${action}`,
        keys,
        action,
      };
      if (idx >= 0) next[idx] = entry;
      else next.push(entry);
      dispatch(settingsActions.setKeyboardShortcuts(next));
    },
    [dispatch, shortcuts],
  );

  const resetDefaults = useCallback(() => {
    void import('../../features/settings/keyboardShortcutsDefaults').then((m) => {
      dispatch(settingsActions.setKeyboardShortcuts(m.getDefaultKeyboardShortcuts()));
    });
  }, [dispatch]);

  useEffect(() => {
    if (!recordingAction) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const ignoreAlone = ['Shift', 'Control', 'Alt', 'Meta'];
      if (ignoreAlone.includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        return;
      }

      const keys: string[] = [];
      if (e.metaKey) keys.push('Meta');
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');

      let main = e.key;
      if (main === ' ') main = 'Space';
      if (main.length === 1) {
        keys.push(main.toUpperCase());
      } else if (!ignoreAlone.includes(main)) {
        keys.push(main);
      }

      if (!keys.some((k) => !['Meta', 'Ctrl', 'Alt', 'Shift'].includes(k))) {
        return;
      }

      replaceShortcut(recordingAction, keys);
      setRecordingAction(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recordingAction, replaceShortcut]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.shortcuts.title')}
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={resetDefaults}>
            {t('settings.shortcuts.resetDefaults')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('settings.shortcuts.description')}
          </p>

          {conflicts.length > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
            >
              {t('settings.shortcuts.conflictWarning')}
              <ul className="list-disc ml-5 mt-1">
                {conflicts.map((sig) => (
                  <li key={sig}>{sig}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            {rows.map(({ def, existing }) => {
              const chord = serializeShortcutChord(existing.keys);
              const hasConflict = conflicts.includes(chord);
              const isRecording = recordingAction === def.action;

              return (
                <div
                  key={def.action}
                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border px-3 py-3 ${
                    hasConflict
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-[var(--sc-border-subtle)] bg-[var(--glass-bg)]'
                  }`}
                >
                  <div>
                    <p className="font-medium text-[var(--sc-text-primary)]">{t(def.labelKey)}</p>
                    <p className="text-xs text-[var(--sc-text-muted)] font-mono">
                      {formatKeysForDisplay(existing.keys)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={isRecording ? 'secondary' : 'ghost'}
                    size="sm"
                    className={isRecording ? 'ring-2 ring-indigo-500 animate-pulse' : ''}
                    onClick={() => setRecordingAction(isRecording ? null : def.action)}
                  >
                    {isRecording
                      ? t('settings.shortcuts.listening')
                      : t('settings.shortcuts.record')}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
