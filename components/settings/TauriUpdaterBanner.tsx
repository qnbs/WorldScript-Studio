import type { FC } from 'react';
import { useTauriUpdater } from '../../hooks/useTauriUpdater';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Spinner } from '../ui/Spinner';

export const TauriUpdaterBanner: FC = () => {
  const { t } = useTranslation();
  const { isDesktop, update, checking, installing, error, checkForUpdate, installUpdate } =
    useTauriUpdater({ autoCheck: true });

  if (!isDesktop) return null;

  return (
    <Card className="border-[var(--sc-border-strong)]">
      <CardContent className="py-4 space-y-2">
        <p className="text-sm font-medium text-[var(--sc-text-primary)]">
          {t('settings.tauri.updaterTitle')}
        </p>
        {checking && <Spinner className="w-5 h-5" />}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {update?.available && (
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('settings.tauri.updateAvailable', {
              current: update.currentVersion,
              next: update.version,
            })}
          </p>
        )}
        {!checking && update && !update.available && (
          <p className="text-xs text-[var(--sc-text-muted)]">{t('settings.tauri.upToDate')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={checking}
            onClick={() => void checkForUpdate()}
          >
            {t('settings.tauri.checkAgain')}
          </Button>
          {update?.available && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={installing}
              onClick={() => void installUpdate()}
            >
              {installing ? t('settings.tauri.installing') : t('settings.tauri.install')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
