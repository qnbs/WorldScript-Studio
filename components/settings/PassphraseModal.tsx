import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export type PassphraseModalMode = 'set' | 'change' | 'disable' | 'unlock';

interface Props {
  mode: PassphraseModalMode;
  onClose: () => void;
  /** Called with (current, next) — for 'set': ('' , passphrase); for 'unlock'/'disable': (passphrase, ''); for 'change': (old, new). */
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
      : mode === 'change'
        ? t('settings.privacy.encryptionModalChangeTitle')
        : mode === 'unlock'
          ? t('settings.privacy.encryptionModalUnlockTitle')
          : t('settings.privacy.encryptionModalDisableTitle');

  const validate = useCallback((): string => {
    if (mode === 'set' || mode === 'change') {
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
        : mode === 'unlock'
          ? t('settings.privacy.encryptionUnlockButton')
          : t('settings.privacy.encryptionDisableButton');

  const hasError = error.length > 0;

  // QNBS-v3: 'disable' mode is a destructive confirmation — alertdialog announces immediately via AT
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={title}
      variant={mode === 'disable' ? 'alertdialog' : 'dialog'}
    >
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

        {(mode === 'change' || mode === 'disable') && (
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
              // QNBS-v3: aria-describedby + aria-invalid wire the error to the field for screen readers
              aria-describedby={hasError ? ERROR_ID : undefined}
              aria-invalid={hasError}
              className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
            />
          </div>
        )}

        {(mode === 'set' || mode === 'change') && (
          <>
            <div className="space-y-1">
              <label
                htmlFor="enc-next"
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.privacy.encryptionNewPassphrase')}
              </label>
              <input
                ref={mode === 'set' ? firstFieldRef : undefined}
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

        {/* forgot passphrase hint — only relevant when entering an existing passphrase */}
        {(mode === 'unlock' || mode === 'disable') && (
          <p className="text-xs text-[var(--sc-text-muted)]">
            {t('settings.privacy.encryptionForgotPassphrase')}{' '}
            <span className="text-[var(--sc-warning-fg)]">
              {t('settings.privacy.encryptionForgotPassphraseWarning')}
            </span>
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
            variant={mode === 'disable' ? 'danger' : 'primary'}
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
