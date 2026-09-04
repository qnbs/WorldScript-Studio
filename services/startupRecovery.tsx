import React from 'react';
import type { Root } from 'react-dom/client';
import { loadStorageErrorCopy, StorageErrorScreen } from '../components/StorageErrorScreen';
import { resetAllDatabases } from './dbInitialization';
import { ProjectLoadError, ProjectQuarantineError } from './fs/projectFsStore';
import { logger } from './logger';
import { getStartupRecoveryActions } from './startupRecoveryPolicy';
import { storageService } from './storageService';

// QNBS-v3: keep startup recovery render decisions testable so destructive reset stays bound to backend provenance.
export async function renderStorageInitializationFailure(root: Root): Promise<void> {
  const copy = await loadStorageErrorCopy();
  root.render(
    <React.StrictMode>
      <StorageErrorScreen
        copy={copy}
        failureKind="storage"
        onReset={async () => {
          await resetAllDatabases();
          window.location.reload();
        }}
      />
    </React.StrictMode>,
  );
}

// QNBS-v3: filesystem failures get preserve-first actions while only IndexedDB failures retain destructive reset authority.
export async function renderProjectInitializationFailure(
  root: Root,
  error: unknown,
): Promise<void> {
  logger.error('Failed to initialize the application:', error);
  const projectLoadError = error instanceof ProjectLoadError ? error : null;
  const backendKind = await storageService.getStorageBackendKind();
  const copy = await loadStorageErrorCopy();
  const { canQuarantine, canReset, failureKind } = getStartupRecoveryActions(error, backendKind);
  const corruptProjectId =
    projectLoadError?.reason === 'corrupt' ? projectLoadError.projectId : null;
  root.render(
    <React.StrictMode>
      <StorageErrorScreen
        copy={copy}
        failureKind={failureKind}
        {...(canQuarantine
          ? {
              onRecover: async () => {
                if (!corruptProjectId) throw new ProjectQuarantineError('io-error');
                const result = await storageService.quarantineProject(corruptProjectId);
                if (!result) throw new ProjectQuarantineError('io-error');
                window.location.reload();
              },
            }
          : {})}
        {...(failureKind === 'project-io' ? { onRetry: () => window.location.reload() } : {})}
        {...(canReset
          ? {
              onReset: async () => {
                await resetAllDatabases();
                window.location.reload();
              },
            }
          : {})}
      />
    </React.StrictMode>,
  );
}
