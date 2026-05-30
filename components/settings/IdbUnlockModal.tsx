import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { verifyAndInitIdbEncryption } from '../../services/storage/storageEncryptionService';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  onUnlocked: () => void;
  onForgotPassphrase?: () => void;
}

export const IdbUnlockModal: FC<Props> = ({ onUnlocked, onForgotPassphrase }) => {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // QNBS-v3: two-step confirm for forgot-passphrase to prevent accidental clicks
  const [showForgotConfirm, setShowForgotConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // QNBS-v3: focus passphrase field on mount via ref — avoids the a11y/noAutofocus lint rule
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // QNBS-v3: WCAG 2.4.3 focus management — when confirmation panel opens, move focus to
  // the Cancel button so keyboard users don't lose their position in the document.
  useEffect(() => {
    if (showForgotConfirm) {
      cancelBtnRef.current?.focus();
    } else {
      // Restore focus to the passphrase input when the panel is dismissed.
      inputRef.current?.focus();
    }
  }, [showForgotConfirm]);

  const handleUnlock = useCallback(async () => {
    if (!passphrase) return;
    setBusy(true);
    setError('');
    try {
      // QNBS-v3: verifyAndInitIdbEncryption decrypts the sentinel — wrong key throws (AES-GCM auth-tag)
      await verifyAndInitIdbEncryption(passphrase);
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

  const errorId = 'idb-unlock-error';
  const hasError = error.length > 0;

  return (
    <Modal
      isOpen={true}
      onClose={() => undefined}
      isDismissible={false}
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
            // QNBS-v3: aria-describedby wired to error element — screen readers read error after field label
            aria-describedby={hasError ? errorId : undefined}
            aria-invalid={hasError}
            className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
          />
        </div>
        {/* role="alert" implies aria-live="assertive" — no need to add both (some AT would double-announce) */}
        <p
          id={errorId}
          role="alert"
          className="text-sm text-[var(--sc-danger-fg)]"
          style={{ minHeight: '1.25rem' }}
        >
          {error}
        </p>
        <div className="flex justify-end">
          <Button
            onClick={() => void handleUnlock()}
            disabled={busy || !passphrase}
            aria-busy={busy}
          >
            {busy ? '…' : t('settings.privacy.encryptionUnlockButton')}
          </Button>
        </div>

        {onForgotPassphrase && (
          <div className="border-t border-[var(--sc-border-subtle)] pt-4 space-y-3">
            {!showForgotConfirm ? (
              <button
                type="button"
                onClick={() => setShowForgotConfirm(true)}
                className="text-sm text-[var(--sc-text-muted)] underline underline-offset-2 hover:text-[var(--sc-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] rounded"
              >
                {t('settings.privacy.encryptionForgotPassphrase')}
              </button>
            ) : (
              <div className="space-y-3">
                {/* QNBS-v3: role="alert" so screen readers immediately read the warning when this section appears */}
                <p
                  id="idb-forgot-warning"
                  role="alert"
                  className="text-sm text-[var(--sc-warning-fg)]"
                >
                  {t('settings.privacy.encryptionForgotPassphraseWarning')}
                </p>
                <div className="flex gap-2 justify-end">
                  <Button ref={cancelBtnRef} onClick={() => setShowForgotConfirm(false)}>
                    {t('common.cancel')}
                  </Button>
                  {/* QNBS-v3: aria-describedby links destructive button to the warning text for AT users */}
                  <Button onClick={onForgotPassphrase} aria-describedby="idb-forgot-warning">
                    {t('settings.privacy.encryptionDisableConfirm')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
