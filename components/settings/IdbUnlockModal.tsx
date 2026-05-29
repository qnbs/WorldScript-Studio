import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { initIdbEncryption } from '../../services/storage/storageEncryptionService';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  onUnlocked: () => void;
}

export const IdbUnlockModal: FC<Props> = ({ onUnlocked }) => {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // QNBS-v3: focus passphrase field on mount via ref — avoids the a11y/noAutofocus lint rule
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = useCallback(async () => {
    if (!passphrase) return;
    setBusy(true);
    setError('');
    try {
      await initIdbEncryption(passphrase);
      onUnlocked();
    } catch {
      setError(t('settings.privacy.encryptionWrongPassphrase'));
    } finally {
      setBusy(false);
    }
  }, [passphrase, onUnlocked, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        void handleUnlock();
      }
    },
    [handleUnlock],
  );

  return (
    <Modal
      isOpen={true}
      // QNBS-v3: no onClose — encrypted storage must be unlocked before use; modal is not dismissable
      onClose={() => undefined}
      title={t('settings.privacy.encryptionModalUnlockTitle')}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('settings.privacy.encryptionLockedStatus')}
        </p>
        <div className="space-y-1">
          <label
            htmlFor="idb-unlock-passphrase"
            className="text-sm font-medium text-[var(--sc-text-primary)]"
          >
            {t('settings.privacy.encryptionPassphrase')}
          </label>
          <input
            id="idb-unlock-passphrase"
            type="password"
            autoComplete="current-password"
            ref={inputRef}
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)] outline-none"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--sc-danger-fg)]">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={() => void handleUnlock()} disabled={busy || !passphrase}>
            {busy ? '…' : t('settings.privacy.encryptionUnlockButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
