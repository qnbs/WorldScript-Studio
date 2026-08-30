import React from 'react';
import { ProjectQuarantineError } from '../services/fs/projectFsStore';
import { getStaticTranslation } from '../services/i18n/staticTranslate';
import { logger } from '../services/logger';

export interface StorageErrorCopy {
  description: string;
  storageUnavailable: string;
  projectUnavailable: string;
  reload: string;
  recover: string;
  recovering: string;
  reset: string;
  quarantineNotice: string;
  recoveryFailed: string;
  recoveryAlreadyPreserved: string;
  resetWarning: string;
}

export const STARTUP_COPY_FALLBACKS: StorageErrorCopy = {
  description: 'The local project or database could not be opened. Reload and try again.',
  storageUnavailable: 'Local storage could not be opened. Reload and try again.',
  projectUnavailable: 'A local project could not be opened. Reload and try again.',
  reload: 'Reload',
  recover: 'Quarantine project and reload',
  recovering: 'Preserving project…',
  reset: 'Reset database and reload',
  quarantineNotice:
    'The complete project folder will be moved to quarantine. No project data will be deleted.',
  recoveryFailed:
    'Project preservation failed. The original project was not deleted. Reload and try again.',
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
    reload,
    recover,
    recovering,
    reset,
    quarantineNotice,
    recoveryFailed,
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
    startupTranslation('error.startup.reload', STARTUP_COPY_FALLBACKS.reload),
    startupTranslation('error.startup.recover', STARTUP_COPY_FALLBACKS.recover),
    startupTranslation('error.startup.recovering', STARTUP_COPY_FALLBACKS.recovering),
    startupTranslation('error.startup.reset', STARTUP_COPY_FALLBACKS.reset),
    startupTranslation('error.startup.quarantineNotice', STARTUP_COPY_FALLBACKS.quarantineNotice),
    startupTranslation('error.startup.recoveryFailed', STARTUP_COPY_FALLBACKS.recoveryFailed),
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
    reload,
    recover,
    recovering,
    reset,
    quarantineNotice,
    recoveryFailed,
    recoveryAlreadyPreserved,
    resetWarning,
  };
}

// QNBS-v3: show stable localized recovery actions while keeping technical filesystem diagnostics in the logger.
export function StorageErrorScreen({
  copy,
  onReset,
  onRecover,
}: {
  copy: StorageErrorCopy;
  onReset?: () => void;
  onRecover?: () => Promise<void>;
}) {
  const [recoveryStatus, setRecoveryStatus] = React.useState<'failed' | 'already-preserved' | null>(
    null,
  );
  const [isRecovering, setIsRecovering] = React.useState(false);

  const handleRecover = async () => {
    if (!onRecover) return;
    setRecoveryStatus(null);
    setIsRecovering(true);
    try {
      await onRecover();
      setIsRecovering(false);
    } catch (error) {
      logger.error('Project quarantine failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      setRecoveryStatus(
        error instanceof ProjectQuarantineError && error.reason === 'already-preserved'
          ? 'already-preserved'
          : 'failed',
      );
      setIsRecovering(false);
    }
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
        {onRecover ? copy.projectUnavailable : copy.storageUnavailable}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: '0.5rem',
            border: '1px solid #334155',
            background: '#1e293b',
            color: '#f1f5f9',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {copy.reload}
        </button>
        {onRecover && (
          <button
            type="button"
            onClick={() => void handleRecover()}
            disabled={isRecovering}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              cursor: isRecovering ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isRecovering ? copy.recovering : copy.recover}
          </button>
        )}
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {copy.reset}
          </button>
        )}
      </div>
      {onRecover && (
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', maxWidth: '32rem' }}>
          {copy.quarantineNotice}
        </p>
      )}
      {recoveryStatus && (
        <p style={{ fontSize: '0.875rem', color: '#fca5a5', maxWidth: '32rem' }}>
          {recoveryStatus === 'already-preserved'
            ? copy.recoveryAlreadyPreserved
            : copy.recoveryFailed}
        </p>
      )}
      {onReset && <p style={{ fontSize: '0.75rem', color: '#475569' }}>{copy.resetWarning}</p>}
    </div>
  );
}
