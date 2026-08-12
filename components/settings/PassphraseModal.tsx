import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export type PassphraseModalMode = 'set' | 'unlock';

interface Props {
  mode: PassphraseModalMode;
  onClose: () => void;
  /** Called with (current, next) — for 'set': ('', passphrase); for 'unlock': (passphrase, ''). */
  onConfirm: (current: string, next: string) => Promise<void>;
}

const MIN_LEN = 8;

// Stable element IDs for aria-describedby / aria-labelledby wiring.
const ERROR_ID = 'passphrase-modal-error';

export const PassphraseModal: FC<Props> = ({ mode, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // QNBS-v3: focus the first relevant field on mount; Biome a11y/noAutofocus bans the HTML attr
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const title =
    mode === 'set'
      ? t('settings.privacy.encryptionModalSetTitle')
      : t('settings.privacy.encryptionModalUnlockTitle');

  const validate = useCallback((): string => {
    if (mode === 'set') {
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
      // QNBS-v3: 'unlock' uses current-passphrase field only (no new passphrase)
      await onConfirm(current, next);
      onClose();
    } catch {
      // QNBS-v3: 'set' has no prior passphrase to be "wrong" — a thrown error there is a storage/salt failure, not an auth-tag mismatch, so only 'unlock' can genuinely fail on a wrong passphrase.
      setError(
        mode === 'set'
          ? t('settings.privacy.encryptionSetupFailed')
          : t('settings.privacy.encryptionWrongPassphrase'),
      );
    } finally {
      setBusy(false);
    }
  }, [validate, onConfirm, onClose, current, next, mode, t]);

  const confirmButtonLabel =
    mode === 'set'
      ? t('settings.privacy.encryptionSetButton')
      : t('settings.privacy.encryptionUnlockButton');

  const hasError = error.length > 0;

  return (
    <Modal isOpen={true} onClose={onClose} title={title}>
      <div className="space-y-4">
        {/* 'unlock' mode: single current-passphrase field to re-derive the in-memory key */}
        {mode === 'unlock' && (
          <div className="space-y-1">
            <label
              htmlFor="enc-current"
              className="text-sm font-medium text-[var(--sc-text-primary)]"
            >
              {t('settings.privacy.encryptionCurrentPassphrase')}
            </label>
            <input
              ref={firstFieldRef}
              id="enc-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setError('');
              }}
              aria-describedby={hasError ? ERROR_ID : undefined}
              aria-invalid={hasError}
              className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
            />
          </div>
        )}

        {mode === 'set' && (
          <>
            <div className="space-y-1">
              <label
                htmlFor="enc-next"
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.privacy.encryptionNewPassphrase')}
              </label>
              <input
                ref={firstFieldRef}
                id="enc-next"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setError('');
                }}
                aria-describedby={hasError ? ERROR_ID : undefined}
                aria-invalid={hasError}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
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
                aria-describedby={hasError ? ERROR_ID : undefined}
                aria-invalid={hasError}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
              />
            </div>
          </>
        )}

        {mode !== 'unlock' && (
          <p className="text-xs text-[var(--sc-warning-fg)] bg-[var(--sc-warning-bg)] rounded-md px-3 py-2">
            {t('settings.privacy.encryptionWarning')}
          </p>
        )}

        {/* QNBS-v3: pre-rendered with minHeight so the DOM node exists before text is injected —
            required by NVDA/JAWS for role="alert" to fire the live-region announcement */}
        <p
          id={ERROR_ID}
          role="alert"
          className="text-sm text-[var(--sc-danger-fg)]"
          style={{ minHeight: '1.25rem' }}
        >
          {error}
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={busy}
            aria-busy={busy}
          >
            {/* QNBS-v3: Spinner replaces ellipsis so AT users get meaningful busy state */}
            {busy ? <Spinner className="w-4 h-4" /> : confirmButtonLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
