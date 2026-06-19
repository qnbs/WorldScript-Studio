import type { FC } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { isTauriRuntime } from '../../services/tauriRuntime';
import { Card, CardContent } from '../ui/Card';

/**
 * QNBS-v3 (T2): Desktop-only (Tauri) settings. Renders nothing on the web — the toggle drives the
 * `minimizeToTray` setting consumed by the close-to-tray handler in App.tsx.
 */
export const DesktopSection: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const minimizeToTray = useAppSelector((s) => s.settings.desktop?.minimizeToTray ?? false);

  if (!isTauriRuntime()) return null;

  return (
    <Card className="border-[var(--sc-border-strong)]">
      <CardContent className="py-4 space-y-3">
        <p className="text-sm font-medium text-[var(--sc-text-primary)]">
          {t('desktop.settings.sectionTitle')}
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 rounded border-[var(--sc-border-subtle)]"
            checked={minimizeToTray}
            onChange={(e) =>
              dispatch(settingsActions.setDesktopSettings({ minimizeToTray: e.target.checked }))
            }
          />
          <span>
            <span className="block text-sm text-[var(--sc-text-primary)]">
              {t('desktop.settings.minimizeToTray')}
            </span>
            <span className="block text-xs text-[var(--sc-text-secondary)]">
              {t('desktop.settings.minimizeToTrayHint')}
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
};
