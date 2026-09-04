import React from 'react';
import { ProjectQuarantineError } from '../services/fs/projectFsStore';
import { getStaticTranslation } from '../services/i18n/staticTranslate';
import { logger } from '../services/logger';
import type { StartupRecoveryFailureKind } from '../services/startupRecoveryPolicy';

export interface StorageErrorCopy {
  description: string;
  storageUnavailable: string;
  projectUnavailable: string;
  projectIoUnavailable: string;
  reload: string;
  retry: string;
  recover: string;
  recovering: string;
  reset: string;
  quarantineNotice: string;
  recoveryFailed: string;
  recoveryUnknown: string;
  recoveryAlreadyPreserved: string;
  resetWarning: string;
}

export const STARTUP_COPY_FALLBACKS: StorageErrorCopy = {
  description: 'The local project or database could not be opened. Reload and try again.',
  storageUnavailable: 'Local storage could not be opened. Reload and try again.',
  projectUnavailable: 'A local project could not be opened. Reload and try again.',
  projectIoUnavailable:
    'The project could not currently be read because of a storage or file-access problem. It has not been classified as corrupt or changed. Check the storage device and file permissions, then retry.',
  reload: 'Reload',
  retry: 'Retry',
  recover: 'Quarantine project and reload',
  recovering: 'Preserving project…',
  reset: 'Reset database and reload',
  quarantineNotice:
    'The complete project folder will be moved to quarantine. No project data will be deleted.',
  recoveryFailed:
    'Project preservation failed. The original project was not deleted. Reload and try again.',
  recoveryUnknown: 'Project preservation could not be confirmed. Reload and try again.',
  recoveryAlreadyPreserved:
    'The project appears to have been preserved by another recovery attempt. Reload to continue.',
  resetWarning: 'Resetting the database will delete all local projects and settings.',
};

async function startupTranslation(key: string, fallback: string): Promise<string> {
  const translated = await getStaticTranslation(key);
  return translated === key ? fallback : translated;
}

// QNBS-v3: load safe localized recovery copy before rendering so raw storage errors never reach users.
export async function loadStorageErrorCopy(): Promise<StorageErrorCopy> {
  const [
    description,
    storageUnavailable,
    projectUnavailable,
    projectIoUnavailable,
    reload,
    retry,
    recover,
    recovering,
    reset,
    quarantineNotice,
    recoveryFailed,
    recoveryUnknown,
    recoveryAlreadyPreserved,
    resetWarning,
  ] = await Promise.all([
    startupTranslation('error.startup.description', STARTUP_COPY_FALLBACKS.description),
    startupTranslation(
      'error.startup.storageUnavailable',
      STARTUP_COPY_FALLBACKS.storageUnavailable,
    ),
    startupTranslation(
      'error.startup.projectUnavailable',
      STARTUP_COPY_FALLBACKS.projectUnavailable,
    ),
    startupTranslation(
      'error.startup.projectIoUnavailable',
      STARTUP_COPY_FALLBACKS.projectIoUnavailable,
    ),
    startupTranslation('error.startup.reload', STARTUP_COPY_FALLBACKS.reload),
    startupTranslation('error.startup.retry', STARTUP_COPY_FALLBACKS.retry),
    startupTranslation('error.startup.recover', STARTUP_COPY_FALLBACKS.recover),
    startupTranslation('error.startup.recovering', STARTUP_COPY_FALLBACKS.recovering),
    startupTranslation('error.startup.reset', STARTUP_COPY_FALLBACKS.reset),
    startupTranslation('error.startup.quarantineNotice', STARTUP_COPY_FALLBACKS.quarantineNotice),
    startupTranslation('error.startup.recoveryFailed', STARTUP_COPY_FALLBACKS.recoveryFailed),
    startupTranslation('error.startup.recoveryUnknown', STARTUP_COPY_FALLBACKS.recoveryUnknown),
    startupTranslation(
      'error.startup.recoveryAlreadyPreserved',
      STARTUP_COPY_FALLBACKS.recoveryAlreadyPreserved,
    ),
    startupTranslation('error.startup.resetWarning', STARTUP_COPY_FALLBACKS.resetWarning),
  ]);
  return {
    description,
    storageUnavailable,
    projectUnavailable,
    projectIoUnavailable,
    reload,
    retry,
    recover,
    recovering,
    reset,
    quarantineNotice,
    recoveryFailed,
    recoveryUnknown,
    recoveryAlreadyPreserved,
    resetWarning,
  };
}

function getFailureMessage(
  failureKind: StartupRecoveryFailureKind,
  copy: StorageErrorCopy,
): string {
  const messages: Record<StartupRecoveryFailureKind, string> = {
    'project-corrupt': copy.projectUnavailable,
    'project-io': copy.projectIoUnavailable,
    storage: copy.storageUnavailable,
  };
  return messages[failureKind];
}

type RecoveryStatus = 'failed' | 'already-preserved' | 'source-missing' | null;

function mapQuarantineErrorReason(error: unknown): Exclude<RecoveryStatus, null> {
  if (error instanceof ProjectQuarantineError && error.reason === 'already-preserved') {
    return 'already-preserved';
  }
  if (error instanceof ProjectQuarantineError && error.reason === 'source-missing') {
    return 'source-missing';
  }
  return 'failed';
}

function getRecoveryStatusText(
  isRecovering: boolean,
  recoveryStatus: RecoveryStatus,
  copy: StorageErrorCopy,
): string {
  if (isRecovering) return copy.recovering;
  if (!recoveryStatus) return '';
  const messages: Record<Exclude<RecoveryStatus, null>, string> = {
    'already-preserved': copy.recoveryAlreadyPreserved,
    'source-missing': copy.recoveryUnknown,
    failed: copy.recoveryFailed,
  };
  return messages[recoveryStatus];
}

const buttonBaseStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  borderRadius: '0.5rem',
  fontFamily: 'inherit',
};

function RetryButton({
  isProjectIo,
  copy,
  onClick,
}: {
  isProjectIo: boolean;
  copy: StorageErrorCopy;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...buttonBaseStyle,
        border: '1px solid #334155',
        background: '#1e293b',
        color: '#f1f5f9',
        cursor: 'pointer',
      }}
    >
      {isProjectIo ? copy.retry : copy.reload}
    </button>
  );
}

function RecoverButton({
  failureKind,
  onRecover,
  isRecovering,
  copy,
  onClick,
}: {
  failureKind: StartupRecoveryFailureKind;
  onRecover: (() => Promise<void>) | undefined;
  isRecovering: boolean;
  copy: StorageErrorCopy;
  onClick: () => void;
}) {
  if (failureKind !== 'project-corrupt' || !onRecover) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isRecovering}
      style={{
        ...buttonBaseStyle,
        border: 'none',
        background: '#2563eb',
        color: '#fff',
        cursor: isRecovering ? 'wait' : 'pointer',
      }}
    >
      {isRecovering ? copy.recovering : copy.recover}
    </button>
  );
}

function RecoveryNotice({
  failureKind,
  onRecover,
  isRecovering,
  recoveryStatus,
  copy,
}: {
  failureKind: StartupRecoveryFailureKind;
  onRecover: (() => Promise<void>) | undefined;
  isRecovering: boolean;
  recoveryStatus: RecoveryStatus;
  copy: StorageErrorCopy;
}) {
  if (failureKind !== 'project-corrupt' || !onRecover) return null;
  return (
    <>
      <p style={{ fontSize: '0.75rem', color: '#94a3b8', maxWidth: '32rem' }}>
        {copy.quarantineNotice}
      </p>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          fontSize: '0.875rem',
          color: recoveryStatus ? '#fca5a5' : '#cbd5e1',
          maxWidth: '32rem',
        }}
      >
        {getRecoveryStatusText(isRecovering, recoveryStatus, copy)}
      </p>
    </>
  );
}

function ResetButton({
  failureKind,
  onReset,
  isRecovering,
  copy,
}: {
  failureKind: StartupRecoveryFailureKind;
  onReset: (() => void) | undefined;
  isRecovering: boolean;
  copy: StorageErrorCopy;
}) {
  if (failureKind !== 'storage' || !onReset) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (!isRecovering) onReset();
      }}
      disabled={isRecovering}
      style={{
        ...buttonBaseStyle,
        border: 'none',
        background: '#dc2626',
        color: '#fff',
        cursor: isRecovering ? 'not-allowed' : 'pointer',
      }}
    >
      {copy.reset}
    </button>
  );
}

function ResetWarning({
  failureKind,
  onReset,
  copy,
}: {
  failureKind: StartupRecoveryFailureKind;
  onReset: (() => void) | undefined;
  copy: StorageErrorCopy;
}) {
  if (failureKind !== 'storage' || !onReset) return null;
  return <p style={{ fontSize: '0.75rem', color: '#475569' }}>{copy.resetWarning}</p>;
}

// QNBS-v3: use explicit failure kinds so I/O retry, quarantine, and database reset cannot be inferred from callbacks.
export function StorageErrorScreen({
  copy,
  onReset,
  onRecover,
  onRetry,
  failureKind,
}: {
  copy: StorageErrorCopy;
  failureKind: StartupRecoveryFailureKind;
  onReset?: () => void;
  onRecover?: () => Promise<void>;
  onRetry?: () => void;
}) {
  const [recoveryStatus, setRecoveryStatus] = React.useState<RecoveryStatus>(null);
  const [isRecovering, setIsRecovering] = React.useState(false);

  const handleRecover = async () => {
    if (!onRecover || failureKind !== 'project-corrupt') return;
    setRecoveryStatus(null);
    setIsRecovering(true);
    try {
      await onRecover();
      setIsRecovering(false);
    } catch (error) {
      logger.error('Project quarantine failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      setRecoveryStatus(mapQuarantineErrorReason(error));
      setIsRecovering(false);
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    window.location.reload();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'Inter, system-ui, sans-serif',
        background: '#0f172a',
        color: '#f1f5f9',
        textAlign: 'center',
        gap: '1rem',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>WorldScript Studio</h1>
      <p style={{ color: '#94a3b8', maxWidth: '32rem' }}>{copy.description}</p>
      <p
        style={{
          background: '#1e293b',
          borderRadius: '0.5rem',
          padding: '0.75rem 1rem',
          fontSize: '0.875rem',
          color: '#fca5a5',
          maxWidth: '32rem',
          wordBreak: 'break-word',
        }}
      >
        {getFailureMessage(failureKind, copy)}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <RetryButton isProjectIo={failureKind === 'project-io'} copy={copy} onClick={handleRetry} />
        <RecoverButton
          failureKind={failureKind}
          onRecover={onRecover}
          isRecovering={isRecovering}
          copy={copy}
          onClick={() => void handleRecover()}
        />
        <ResetButton
          failureKind={failureKind}
          onReset={onReset}
          isRecovering={isRecovering}
          copy={copy}
        />
      </div>
      <RecoveryNotice
        failureKind={failureKind}
        onRecover={onRecover}
        isRecovering={isRecovering}
        recoveryStatus={recoveryStatus}
        copy={copy}
      />
      <ResetWarning failureKind={failureKind} onReset={onReset} copy={copy} />
    </div>
  );
}
