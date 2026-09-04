import { ProjectLoadError } from './fs/projectFsStore';

export type StartupStorageBackend = 'indexeddb' | 'filesystem';
export type StartupRecoveryFailureKind = 'storage' | 'project-corrupt' | 'project-io';

export interface StartupRecoveryActions {
  failureKind: StartupRecoveryFailureKind;
  canQuarantine: boolean;
  canReset: boolean;
}

// QNBS-v3: separate project I/O retry UX from corruption so non-destructive failures never gain quarantine authority.
export function getStartupRecoveryActions(
  error: unknown,
  backend: StartupStorageBackend,
): StartupRecoveryActions {
  const projectLoadError = error instanceof ProjectLoadError ? error : null;
  const failureKind: StartupRecoveryFailureKind =
    projectLoadError?.reason === 'corrupt'
      ? 'project-corrupt'
      : projectLoadError || backend === 'filesystem'
        ? 'project-io'
        : 'storage';
  return {
    failureKind,
    canQuarantine: failureKind === 'project-corrupt' && backend === 'filesystem',
    canReset: failureKind === 'storage' && backend === 'indexeddb',
  };
}
