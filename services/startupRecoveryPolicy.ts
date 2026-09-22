import { ProjectLoadError } from './fs/projectFsStore';

export type StartupStorageBackend = 'indexeddb' | 'filesystem';
export type StartupRecoveryFailureKind =
  | 'storage'
  | 'project-corrupt'
  | 'project-io'
  | 'project-unsupported'
  | 'project-migration-gap';

export interface StartupRecoveryActions {
  failureKind: StartupRecoveryFailureKind;
  canQuarantine: boolean;
  canReset: boolean;
  canSafeOpen: boolean;
}

// QNBS-v3: separate project I/O retry UX from corruption so non-destructive failures never gain quarantine authority.
export function getStartupRecoveryActions(
  error: unknown,
  backend: StartupStorageBackend,
): StartupRecoveryActions {
  const projectLoadError = error instanceof ProjectLoadError ? error : null;
  const failureKind: StartupRecoveryFailureKind =
    projectLoadError?.classification === 'UNSUPPORTED_OLDER'
      ? 'project-migration-gap'
      : projectLoadError?.reason === 'unsupported-version'
        ? 'project-unsupported'
        : projectLoadError?.reason === 'corrupt'
          ? 'project-corrupt'
          : projectLoadError || backend === 'filesystem'
            ? 'project-io'
            : 'storage';
  return {
    failureKind,
    canQuarantine: failureKind === 'project-corrupt' && backend === 'filesystem',
    canReset: failureKind === 'storage' && backend === 'indexeddb',
    // QNBS-v3: Safe Open is non-destructive and only meaningful for a refused desktop project — never for I/O, corrupt, or IndexedDB failures.
    canSafeOpen:
      projectLoadError !== null &&
      backend === 'filesystem' &&
      (failureKind === 'project-unsupported' || failureKind === 'project-migration-gap'),
  };
}
