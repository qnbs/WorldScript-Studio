import type { ChangeEventHandler, FC } from 'react';
import { useRef, useState } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { APP_FILE_SLUG, ICONS } from '../../constants';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { settingsActions } from '../../features/settings/settingsSlice';
import { statusActions } from '../../features/status/statusSlice';
import { buildEncryptedLibraryZipBlob } from '../../services/libraryBackupService';
import {
  buildSettingsExportEnvelope,
  parseSettingsImportEnvelope,
} from '../../services/settingsExchange';
import { isTauriRuntime, openTauriDataDirectory } from '../../services/tauriRuntime';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

export const DataSection: FC = () => {
  const {
    t,
    settings,
    handleExport,
    handleImport,
    importFileRef,
    setModal,
    projectSize,
    snapshots,
    setSnapshotName,
    handleRepeatOnboarding,
  } = useSettingsViewContext();
  const dispatch = useAppDispatch();
  const settingsImportRef = useRef<HTMLInputElement>(null);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  const [libraryPassphrase, setLibraryPassphrase] = useState('');
  const [libraryBusy, setLibraryBusy] = useState(false);

  const handleEncryptedLibraryExport = async () => {
    const pass = libraryPassphrase.trim();
    if (!pass) return;
    setLibraryBusy(true);
    try {
      const blob = await buildEncryptedLibraryZipBlob(pass);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${APP_FILE_SLUG}-library-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      dispatch(
        statusActions.addNotification({
          type: 'success',
          title: t('settings.data.libraryExport.successTitle'),
          description: t('settings.data.libraryExport.successBody'),
        }),
      );
      setLibraryModalOpen(false);
      setLibraryPassphrase('');
    } catch {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('settings.data.libraryExport.errorTitle'),
          description: t('settings.data.libraryExport.errorBody'),
        }),
      );
    } finally {
      setLibraryBusy(false);
    }
  };

  const handleExportSettingsJson = () => {
    const envelope = buildSettingsExportEnvelope(settings);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_FILE_SLUG}-settings.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSettingsFile: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        const partial = parseSettingsImportEnvelope(parsed);
        if (!partial) return;
        dispatch(settingsActions.setSettings({ ...settings, ...partial }));
      } catch {
        /* invalid file */
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.data.title')}
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--sc-text-secondary)] mb-6">
            {t('settings.data.description')}
          </p>
          <div className="p-4 rounded-lg bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)] space-y-3">
            <h3 className="font-semibold text-[var(--sc-text-primary)]">
              {t('settings.data.actions')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Button onClick={handleExport} variant="secondary">
                {t('settings.data.export')}
              </Button>
              <Button onClick={() => importFileRef.current?.click()} variant="secondary">
                {t('settings.data.import')}
              </Button>
              <input
                type="file"
                ref={importFileRef}
                onChange={handleImport}
                accept=".json"
                className="hidden"
              />
              <Button onClick={() => setModal({ state: 'reset', payload: {} })} variant="danger">
                {t('settings.data.reset')}
              </Button>
            </div>
          </div>
          <div className="text-xs text-center text-[var(--sc-text-muted)] pt-2">
            {t('settings.data.projectSize', { size: projectSize })}
          </div>
          {isTauriRuntime() && (
            <div className="mt-4 space-y-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void openTauriDataDirectory()}
              >
                {t('settings.data.openDataFolder')}
              </Button>
              <p className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.data.openDataFolderHint')}
              </p>
            </div>
          )}
          <div className="mt-6 pt-6 border-t border-[var(--sc-border-subtle)] space-y-3">
            <h3 className="font-semibold text-[var(--sc-text-primary)]">
              {t('settings.data.libraryExport.title')}
            </h3>
            <p className="text-sm text-[var(--sc-text-secondary)]">
              {t('settings.data.libraryExport.description')}
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLibraryModalOpen(true)}
              disabled={libraryBusy}
            >
              {t('settings.data.libraryExport.button')}
            </Button>
          </div>
          <div className="mt-6 pt-6 border-t border-[var(--sc-border-subtle)] space-y-3">
            <h3 className="font-semibold text-[var(--sc-text-primary)]">
              {t('settings.data.settingsFile.title')}
            </h3>
            <p className="text-sm text-[var(--sc-text-secondary)]">
              {t('settings.data.settingsFile.description')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={handleExportSettingsJson}>
                {t('settings.data.settingsFile.export')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => settingsImportRef.current?.click()}
              >
                {t('settings.data.settingsFile.import')}
              </Button>
              <input
                ref={settingsImportRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportSettingsFile}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* QNBS-v3: Full library export AES-GCM in ZIP — key only as user passphrase. */}
      <Modal
        isOpen={libraryModalOpen}
        onClose={() => {
          if (!libraryBusy) {
            setLibraryModalOpen(false);
            setLibraryPassphrase('');
          }
        }}
        title={t('settings.data.libraryExport.title')}
      >
        <div className="space-y-4">
          <label
            htmlFor="library-backup-passphrase"
            className="text-sm font-medium text-[var(--sc-text-secondary)] block"
          >
            {t('settings.data.libraryExport.passphraseLabel')}
          </label>
          <Input
            id="library-backup-passphrase"
            type="password"
            autoComplete="new-password"
            value={libraryPassphrase}
            onChange={(e) => setLibraryPassphrase(e.target.value)}
            placeholder={t('settings.data.libraryExport.passphrasePlaceholder')}
            className="w-full"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              disabled={libraryBusy}
              onClick={() => {
                setLibraryModalOpen(false);
                setLibraryPassphrase('');
              }}
            >
              {t('settings.data.libraryExport.cancel')}
            </Button>
            <Button
              type="button"
              disabled={libraryBusy || !libraryPassphrase.trim()}
              aria-busy={libraryBusy}
              onClick={() => void handleEncryptedLibraryExport()}
            >
              {libraryBusy
                ? t('settings.data.libraryExport.busy')
                : t('settings.data.libraryExport.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.data.snapshots')}
          </h2>
          <Button
            onClick={() => {
              setSnapshotName('');
              setModal({ state: 'create', payload: {} });
            }}
          >
            {t('settings.data.createSnapshot')}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--sc-text-secondary)] mb-4">
            {t('settings.data.snapshotsDescription')}
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {snapshots.length > 0 ? (
              snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="flex items-center justify-between p-3 bg-[var(--glass-bg)] rounded-md border border-[var(--sc-border-subtle)] hover:border-[var(--border-interactive)] transition-colors"
                >
                  <div>
                    <p className="font-semibold text-[var(--sc-text-primary)]">
                      {snap.name === 'Automatic Snapshot'
                        ? t('settings.data.automaticSnapshot')
                        : snap.name}
                    </p>
                    <p className="text-xs text-[var(--sc-text-muted)]">
                      {new Date(snap.date).toLocaleString()} - {snap.wordCount}{' '}
                      {t('dashboard.stats.totalWordCount')}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      onClick={() =>
                        setModal({
                          state: 'restore',
                          payload: {
                            id: snap.id,
                            date: new Date(snap.date).toLocaleString(),
                            wordCount: snap.wordCount,
                          },
                        })
                      }
                      variant="secondary"
                      size="sm"
                    >
                      {t('settings.data.restore')}
                    </Button>
                    <Button
                      onClick={() =>
                        setModal({
                          state: 'delete',
                          payload: { id: snap.id, name: snap.name },
                        })
                      }
                      variant="ghost"
                      size="sm"
                      className="text-[var(--sc-danger-fg)] hover:bg-[var(--sc-danger-bg)]"
                      aria-label={`${t('settings.data.delete')} ${snap.name}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-5 h-5"
                      >
                        {ICONS.TRASH}
                      </svg>
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-12 border-2 border-dashed border-[var(--sc-border-subtle)] rounded-xl bg-[var(--sc-surface-raised)]/30">
                <div className="p-4 rounded-full bg-[var(--sc-surface-overlay)] mb-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-8 h-8 text-[var(--sc-text-muted)]"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                  {t('settings.data.noSnapshots')}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border border-[var(--sc-danger-border)]">
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-danger-fg)]">
            {t('settings.data.dangerZone.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-secondary)] mt-1">
            {t('settings.data.dangerZone.description')}
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Repeat Onboarding */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                  {t('settings.data.repeatOnboarding.label')}
                </p>
                <p className="text-xs text-[var(--sc-text-muted)] mt-0.5">
                  {t('settings.data.repeatOnboarding.hint')}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRepeatOnboarding}
                className="shrink-0"
              >
                {t('settings.data.repeatOnboarding.button')}
              </Button>
            </div>

            {/* Factory Reset */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-[var(--sc-danger-bg)]/50 border border-[var(--sc-danger-border)]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--sc-danger-fg)]">
                  {t('settings.data.dangerZone.factoryReset.label')}
                </p>
                <p className="text-xs text-[var(--sc-text-muted)] mt-0.5">
                  {t('settings.data.dangerZone.factoryReset.hint')}
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setModal({ state: 'factoryReset', payload: {} })}
                className="shrink-0"
              >
                {t('settings.data.dangerZone.factoryReset.button')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
