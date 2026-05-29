import type { FC } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export type PassphraseModalMode = 'set' | 'change' | 'disable';

interface Props {
  mode: PassphraseModalMode;
  onClose: () => void;
  /** Called with (newPassphrase) for set, (currentPassphrase, newPassphrase) for change, (currentPassphrase) for disable */
  onConfirm: (current: string, next: string) => Promise<void>;
}

const MIN_LEN = 8;

export const PassphraseModal: FC<Props> = ({ mode, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const title =
    mode === 'set'
      ? t('settings.privacy.encryptionModalSetTitle')
      : mode === 'change'
        ? t('settings.privacy.encryptionModalChangeTitle')
        : t('settings.privacy.encryptionModalDisableTitle');

  const validate = useCallback((): string => {
    if (mode !== 'disable') {
      if (next.length < MIN_LEN) return t('settings.privacy.encryptionTooShort');
      if (next !== confirm) return t('settings.privacy.encryptionMismatch');
    }
    return '';
  }, [mode, next, confirm, t]);

  const handleSubmit = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(current, next);
      onClose();
    } catch {
      setError(t('settings.privacy.encryptionWrongPassphrase'));
    } finally {
      setBusy(false);
    }
  }, [validate, onConfirm, onClose, current, next, t]);

  const confirmButtonLabel =
    mode === 'set'
      ? t('settings.privacy.encryptionSetButton')
      : mode === 'change'
        ? t('settings.privacy.encryptionChangeButton')
        : t('settings.privacy.encryptionDisableButton');

  return (
    <Modal isOpen={true} onClose={onClose} title={title}>
      <div className="space-y-4">
        {(mode === 'change' || mode === 'disable') && (
          <div className="space-y-1">
            <label
              htmlFor="enc-current"
              className="text-sm font-medium text-[var(--sc-text-primary)]"
            >
              {t('settings.privacy.encryptionCurrentPassphrase')}
            </label>
            <input
              id="enc-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)] outline-none"
            />
          </div>
        )}

        {mode !== 'disable' && (
          <>
            <div className="space-y-1">
              <label
                htmlFor="enc-next"
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.privacy.encryptionNewPassphrase')}
              </label>
              <input
                id="enc-next"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setError('');
                }}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)] outline-none"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="enc-confirm"
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.privacy.encryptionConfirmPassphrase')}
              </label>
              <input
                id="enc-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError('');
                }}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)] outline-none"
              />
            </div>
          </>
        )}

        <p className="text-xs text-[var(--sc-warning-fg)] bg-[var(--sc-warning-bg)] rounded-md px-3 py-2">
          {t('settings.privacy.encryptionWarning')}
        </p>

        {error && (
          <p role="alert" className="text-sm text-[var(--sc-danger-fg)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={mode === 'disable' ? 'danger' : 'primary'}
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? '…' : confirmButtonLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
