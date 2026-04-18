import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';

export const SettingsModals: FC = () => {
  const {
    t,
    modal,
    setModal,
    handleResetProject,
    snapshotName,
    setSnapshotName,
    handleCreateSnapshot,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
    currentWordCount,
  } = useSettingsViewContext();

  if (modal.state === 'closed') return null;

  if (modal.state === 'reset')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.resetModal.title')}
      >
        <div className="space-y-4">
          {' '}
          <p className="text-[var(--foreground-secondary)]">
            {t('settings.resetModal.description')}
          </p>{' '}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleResetProject}>
              {t('settings.resetModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    );

  if (modal.state === 'create')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.data.createSnapshot')}
      >
        <div className="space-y-4">
          <label htmlFor="snapshot-name">{t('settings.data.snapshotName')}</label>
          <Input
            id="snapshot-name"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            placeholder={t('settings.data.snapshotNamePlaceholder')}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateSnapshot}>{t('common.generate')}</Button>
          </div>
        </div>
      </Modal>
    );

  if (modal.state === 'restore')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.restoreModal.title')}
      >
        <div className="space-y-4">
          <p className="text-[var(--foreground-secondary)]">
            {t('settings.restoreModal.description', {
              date: modal.payload.date || 'the past',
            })}
          </p>
          <p className="text-sm bg-[var(--background-tertiary)] p-3 rounded-md border border-[var(--border-primary)]">
            {t('settings.restoreModal.wordCountInfo', {
              snapshotWordCount: String(modal.payload.wordCount || 0),
              currentWordCount: String(currentWordCount),
            })}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleRestoreSnapshot}>
              {t('settings.restoreModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    );

  if (modal.state === 'delete')
    return (
      <Modal
        isOpen={true}
        onClose={() => setModal({ state: 'closed', payload: {} })}
        title={t('settings.deleteModal.title')}
      >
        <div className="space-y-4">
          <p className="text-[var(--foreground-secondary)]">
            {t('settings.deleteModal.description')}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModal({ state: 'closed', payload: {} })}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteSnapshot}>
              {t('settings.deleteModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    );

  return null;
};
