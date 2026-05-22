import type { ChangeEvent, FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { selectAllCharacters, selectAllWorlds } from '../../features/project/projectSelectors';
import { importProjectThunk } from '../../features/project/thunks/projectManagementThunks';
import { statusActions } from '../../features/status/statusSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { storageService } from '../../services/storageService';
import type { ProjectSnapshot, StoryProject, View } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';

export const SETTINGS_CATEGORY_STORAGE_KEY = 'storycraft-settings-category';

export interface BackupQuickActionsCardProps {
  onNavigate: (view: View) => void;
}

export const BackupQuickActionsCard: FC<BackupQuickActionsCardProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => s.project.present.data);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const importRef = useRef<HTMLInputElement>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<ProjectSnapshot | null>(null);

  const refreshSnapshots = useCallback(async () => {
    const snaps = await storageService.listSnapshots();
    const sorted = [...snaps].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    setLatestSnapshot(sorted[0] ?? null);
  }, []);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  const handleExport = useCallback(() => {
    if (!project) return;
    const payload: StoryProject = { ...project, characters, worlds };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${project.title.replace(/\s+/g, '_')}_backup.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [project, characters, worlds]);

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const result = await dispatch(importProjectThunk(file));
      if (importProjectThunk.fulfilled.match(result)) {
        dispatch(
          statusActions.addNotification({
            type: 'success',
            title: t('settings.data.importSuccess'),
          }),
        );
      } else {
        dispatch(
          statusActions.addNotification({
            type: 'error',
            title: t('settings.data.importError'),
          }),
        );
      }
      event.target.value = '';
    },
    [dispatch, t],
  );

  const openBackupSettings = useCallback(() => {
    try {
      sessionStorage.setItem(SETTINGS_CATEGORY_STORAGE_KEY, 'backup');
    } catch {
      /* ignore */
    }
    onNavigate('settings');
  }, [onNavigate]);

  return (
    <Card className="animate-in" style={{ '--index': 6 } as React.CSSProperties}>
      <CardHeader>
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--sc-text-muted)]">
          {t('dashboard.backup.title')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--sc-text-secondary)]">{t('dashboard.backup.hint')}</p>
        {latestSnapshot && (
          <p className="text-xs text-[var(--sc-text-muted)]">
            {t('dashboard.backup.latestSnapshot', {
              name: latestSnapshot.name || t('dashboard.backup.unnamedSnapshot'),
              date: new Date(latestSnapshot.date).toLocaleString(),
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleExport}>
            {t('dashboard.backup.exportJson')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => importRef.current?.click()}
          >
            {t('dashboard.backup.importJson')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={openBackupSettings}>
            {t('dashboard.backup.openSettings')}
          </Button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-hidden
          onChange={(e) => void handleImport(e)}
        />
      </CardContent>
    </Card>
  );
};
