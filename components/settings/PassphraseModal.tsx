import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { logger } from '../../services/logger';
import type { ProtectedStoreMigrationProgress } from '../../services/storage/protectedStoreMigration';
import { IdbWrongPassphraseError } from '../../services/storage/storageEncryptionService';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export type PassphraseModalMode = 'set' | 'unlock' | 'disable' | 'rotate';

interface Props {
  mode: PassphraseModalMode;
  onClose: () => void;
  /** Called with (current, next) — for 'set': ('', passphrase); for 'unlock'/'rotate': (passphrase, next); for 'disable': ('', ''), since useSettingsView reads the passphrase from the already-unlocked session key instead. */
  onConfirm: (current: string, next: string) => Promise<void>;
  /** Live progress while a 'disable'/'rotate' migration runs across every protected store. */
  progress?: ProtectedStoreMigrationProgress | null;
}

const MIN_LEN = 8;
const NEEDS_NEW_PASSPHRASE: readonly PassphraseModalMode[] = ['set', 'rotate'];
const NEEDS_CURRENT_PASSPHRASE: readonly PassphraseModalMode[] = ['unlock', 'rotate'];

// Stable element IDs for aria-describedby / aria-labelledby wiring.
const ERROR_ID = 'passphrase-modal-error';

const TITLE_KEY: Record<PassphraseModalMode, string> = {
  set: 'settings.privacy.encryptionModalSetTitle',
  unlock: 'settings.privacy.encryptionModalUnlockTitle',
  disable: 'settings.privacy.encryptionModalDisableTitle',
  rotate: 'settings.privacy.encryptionModalChangeTitle',
};

const CONFIRM_BUTTON_KEY: Record<PassphraseModalMode, string> = {
  set: 'settings.privacy.encryptionSetButton',
  unlock: 'settings.privacy.encryptionUnlockButton',
  disable: 'settings.privacy.encryptionDisableButton',
  rotate: 'settings.privacy.encryptionChangeButton',
};

export const PassphraseModal: FC<Props> = ({ mode, onClose, onConfirm, progress }) => {
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

  const title = t(TITLE_KEY[mode]);
  const needsNewPassphrase = NEEDS_NEW_PASSPHRASE.includes(mode);
  const needsCurrentPassphrase = NEEDS_CURRENT_PASSPHRASE.includes(mode);

  const validate = useCallback((): string => {
    if (needsNewPassphrase) {
      if (next.length < MIN_LEN) return t('settings.privacy.encryptionTooShort');
      if (next !== confirm) return t('settings.privacy.encryptionMismatch');
    }
    return '';
  }, [needsNewPassphrase, next, confirm, t]);

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
    } catch (err) {
      // QNBS-v3: 'set' has no prior passphrase to be "wrong" (storage/salt failure instead).
      // 'unlock'/'rotate' can fail on a genuine wrong current passphrase (IdbWrongPassphraseError)
      // OR — for 'rotate' specifically — on an unrelated migration/journal failure (active/
      // recovery-required journal, adapter error); only the former is fixed by re-entering
      // credentials, so they need visibly different messages.
      if (mode === 'set') {
        setError(t('settings.privacy.encryptionSetupFailed'));
      } else if (mode === 'disable') {
        setError(t('settings.privacy.encryptionDisableFailed'));
      } else if (err instanceof IdbWrongPassphraseError) {
        setError(t('settings.privacy.encryptionWrongPassphrase'));
      } else {
        setError(t('settings.privacy.encryptionRecoveryFailed'));
        logger.warn(`PassphraseModal ${mode} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setBusy(false);
    }
  }, [validate, onConfirm, onClose, current, next, mode, t]);

  const confirmButtonLabel = t(CONFIRM_BUTTON_KEY[mode]);

  const hasError = error.length > 0;
  const progressFraction =
    progress && progress.storeCount > 0
      ? Math.min(
          1,
          (progress.storeIndex + (progress.phase === 'verifying' ? 0.5 : 0)) / progress.storeCount,
        )
      : null;

  // QNBS-v3: not dismissible while busy (a disable/rotate migration is running) — closing mid-migration would leave it running with no visible progress.
  return (
    <Modal isOpen={true} onClose={onClose} isDismissible={!busy} title={title}>
      <div className="space-y-4">
        {/* 'unlock'/'rotate': current-passphrase field re-derives/verifies the in-memory key */}
        {needsCurrentPassphrase && (
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
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] outline-none"
            />
          </div>
        )}

        {needsNewPassphrase && (
          <>
            <div className="space-y-1">
              <label
                htmlFor="enc-next"
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.privacy.encryptionNewPassphrase')}
              </label>
              <input
                ref={!needsCurrentPassphrase ? firstFieldRef : undefined}
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
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] outline-none"
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
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] outline-none"
              />
            </div>
          </>
        )}

        {mode === 'disable' ? (
          <p className="text-xs text-[var(--sc-warning-fg)] bg-[var(--sc-warning-bg)] rounded-md px-3 py-2">
            {t('settings.privacy.encryptionDisableConfirm')}
          </p>
        ) : (
          (mode === 'set' || mode === 'rotate') && (
            <p className="text-xs text-[var(--sc-warning-fg)] bg-[var(--sc-warning-bg)] rounded-md px-3 py-2">
              {t('settings.privacy.encryptionWarning')}
            </p>
          )
        )}

        {busy && progress && progress.storeCount > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-[var(--sc-text-secondary)]" aria-live="polite">
              {t('settings.privacy.encryptionMigrationProgress', {
                current: Math.min(progress.storeIndex + 1, progress.storeCount),
                total: progress.storeCount,
              })}
            </p>
            <div
              role="progressbar"
              aria-label={t('settings.privacy.encryptionMigrationProgressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((progressFraction ?? 0) * 100)}
              className="h-2 w-full rounded-full bg-[var(--sc-surface-inset)] overflow-hidden"
            >
              <div
                className="h-full bg-[var(--sc-border-focus)] transition-[width]"
                style={{ width: `${Math.round((progressFraction ?? 0) * 100)}%` }}
              />
            </div>
          </div>
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
