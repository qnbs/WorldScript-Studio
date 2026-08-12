import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import type { EncryptionMigrationJournal } from '../../services/storage/encryptionMigrationJournal';
import type { ProtectedStoreMigrationProgress } from '../../services/storage/protectedStoreMigration';
import { resumeEncryptionMigration } from '../../services/storage/storageEncryptionService';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  journal: EncryptionMigrationJournal;
  onRecovered: () => void;
}

const ERROR_ID = 'encryption-recovery-error';

/**
 * Shown instead of the normal unlock flow whenever a disable/rotate migration was interrupted
 * (page reload, crash) before reaching 'completed'. The journal is durable and resumable — every
 * store's progress survived — but CryptoKey material is never persisted, so the passphrase(s)
 * must be re-entered to resume. 'recovery-required' is a distinct, non-resumable stuck state (the
 * migration's own verification found an inconsistency) that this modal surfaces but cannot fix —
 * it requires a dedicated manual-recovery procedure, not a normal retry.
 */
export const EncryptionRecoveryModal: FC<Props> = ({ journal, onRecovered }) => {
  const { t } = useTranslation();
  const [sourcePassphrase, setSourcePassphrase] = useState('');
  const [targetPassphrase, setTargetPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProtectedStoreMigrationProgress | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const stuck = journal.phase === 'recovery-required';
  const needsTargetPassphrase = journal.operation === 'rekey';

  const progressFraction = useMemo(
    () =>
      progress && progress.storeCount > 0
        ? Math.min(
            1,
            (progress.storeIndex + (progress.phase === 'verifying' ? 0.5 : 0)) /
              progress.storeCount,
          )
        : null,
    [progress],
  );

  const handleResume = useCallback(async () => {
    setBusy(true);
    setError('');
    setProgress(null);
    try {
      await resumeEncryptionMigration(
        journal,
        {
          sourcePassphrase,
          ...(needsTargetPassphrase ? { targetPassphrase } : {}),
        },
        (next) => setProgress(next),
      );
      onRecovered();
    } catch {
      setError(t('settings.privacy.encryptionWrongPassphrase'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [journal, sourcePassphrase, targetPassphrase, needsTargetPassphrase, onRecovered, t]);

  const hasError = error.length > 0;
  const canSubmit =
    !busy && sourcePassphrase.length > 0 && (!needsTargetPassphrase || targetPassphrase.length > 0);

  return (
    <Modal
      isOpen={true}
      onClose={() => undefined}
      isDismissible={false}
      title={t('settings.privacy.encryptionRecoveryTitle')}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {journal.operation === 'disable'
            ? t('settings.privacy.encryptionRecoveryBodyDisable')
            : t('settings.privacy.encryptionRecoveryBodyRotate')}
        </p>

        {stuck ? (
          <p className="text-sm text-[var(--sc-danger-fg)] bg-[var(--sc-danger-border)]/10 rounded-md px-3 py-2">
            {t('settings.privacy.encryptionRecoveryStuck')}
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <label
                htmlFor="recovery-source"
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {journal.operation === 'rekey'
                  ? t('settings.privacy.encryptionCurrentPassphrase')
                  : t('settings.privacy.encryptionPassphrase')}
              </label>
              <input
                ref={firstFieldRef}
                id="recovery-source"
                type="password"
                autoComplete="current-password"
                value={sourcePassphrase}
                onChange={(e) => {
                  setSourcePassphrase(e.target.value);
                  setError('');
                }}
                aria-describedby={hasError ? ERROR_ID : undefined}
                aria-invalid={hasError}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
              />
            </div>

            {needsTargetPassphrase && (
              <div className="space-y-1">
                <label
                  htmlFor="recovery-target"
                  className="text-sm font-medium text-[var(--sc-text-primary)]"
                >
                  {t('settings.privacy.encryptionNewPassphrase')}
                </label>
                <input
                  id="recovery-target"
                  type="password"
                  autoComplete="new-password"
                  value={targetPassphrase}
                  onChange={(e) => {
                    setTargetPassphrase(e.target.value);
                    setError('');
                  }}
                  aria-describedby={hasError ? ERROR_ID : undefined}
                  aria-invalid={hasError}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
                />
              </div>
            )}

            {busy && progress && progress.storeCount > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-[var(--sc-text-secondary)]">
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

            <p
              id={ERROR_ID}
              role="alert"
              className="text-sm text-[var(--sc-danger-fg)]"
              style={{ minHeight: '1.25rem' }}
            >
              {error}
            </p>

            <div className="flex justify-end">
              <Button onClick={() => void handleResume()} disabled={!canSubmit} aria-busy={busy}>
                {t('settings.privacy.encryptionRecoveryResumeButton')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
