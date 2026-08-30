import { ProjectLoadError } from './fs/projectFsStore';

export type StartupStorageBackend = 'indexeddb' | 'filesystem';

// QNBS-v3: bind destructive reset to IndexedDB provenance so desktop filesystem failures stay preserve-first.
export function getStartupRecoveryActions(
  error: unknown,
  backend: StartupStorageBackend,
): { canQuarantine: boolean; canReset: boolean } {
  const projectLoadError = error instanceof ProjectLoadError ? error : null;
  return {
    canQuarantine: projectLoadError?.reason === 'corrupt' && backend === 'filesystem',
    canReset: !projectLoadError && backend === 'indexeddb',
  };
}
