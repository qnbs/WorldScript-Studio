import type { FC } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { isTauriRuntime } from '../../services/tauriRuntime';
import { Card, CardContent } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

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
        {/* QNBS-v3 (P1.3): the design-system ToggleSwitch (role=switch + aria-describedby hint)
            replaces the only raw <input type="checkbox"> left in Settings — a11y + DS consistency. */}
        <ToggleSwitch
          label={t('desktop.settings.minimizeToTray')}
          hint={t('desktop.settings.minimizeToTrayHint')}
          checked={minimizeToTray}
          onChange={(checked) =>
            dispatch(settingsActions.setDesktopSettings({ minimizeToTray: checked }))
          }
        />
      </CardContent>
    </Card>
  );
};
