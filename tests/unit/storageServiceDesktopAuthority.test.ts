import { afterEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3 (#553 a8): the storage manager is a module singleton — each case builds a fresh one with its own runtime and backend doubles.
function backendDouble(label: string) {
  return {
    label,
    initialize: vi.fn().mockResolvedValue(undefined),
    removeLegacyApiKeyFiles: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn().mockResolvedValue([`${label}-project`]),
    loadProject: vi.fn().mockResolvedValue(null),
    saveProject: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(null),
  };
}

async function loadStorageService(options: {
  tauri: boolean;
  configure?: (fs: ReturnType<typeof backendDouble>) => void;
}) {
  vi.resetModules();
  const fs = backendDouble('fs');
  const db = backendDouble('idb');
  options.configure?.(fs);
  vi.doMock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => options.tauri }));
  vi.doMock('../../services/fileSystemService', () => ({ fileSystemService: fs }));
  vi.doMock('../../services/dbService', () => ({ dbService: db }));
  const { storageService } = await import('../../services/storageService');
  const { DesktopStorageAuthorityUnavailableError } = await import('../../services/fs/fsCore');
  return { storageService, fs, db, DesktopStorageAuthorityUnavailableError };
}

afterEach(() => {
  vi.doUnmock('../../services/tauriRuntime');
  vi.doUnmock('../../services/fileSystemService');
  vi.doUnmock('../../services/dbService');
});

describe('desktop storage authority (#553 a8)', () => {
  it('uses the filesystem when desktop storage opens', async () => {
    const { storageService, fs, db } = await loadStorageService({ tauri: true });

    await expect(storageService.getStorageBackendKind()).resolves.toBe('filesystem');
    await expect(storageService.getProjectAuthority()).resolves.toBe('fs');
    await expect(storageService.listProjects()).resolves.toEqual(['fs-project']);
    expect(db.listProjects).not.toHaveBeenCalled();
    expect(fs.removeLegacyApiKeyFiles).toHaveBeenCalled();
  });

  it('never switches to IndexedDB when desktop storage cannot be opened', async () => {
    const { storageService, fs, db, DesktopStorageAuthorityUnavailableError } =
      await loadStorageService({
        tauri: true,
        configure: (double) => double.initialize.mockRejectedValue(new Error('permission denied')),
      });

    // The recovery layer can still classify the failure without touching storage.
    await expect(storageService.getStorageBackendKind()).resolves.toBe('filesystem');
    for (const access of [
      () => storageService.getProjectAuthority(),
      () => storageService.listProjects(),
      () => storageService.loadProject('p1'),
      () => storageService.saveProject({ data: { id: 'p1' } } as never),
      () => storageService.loadSettings(),
    ]) {
      await expect(access()).rejects.toBeInstanceOf(DesktopStorageAuthorityUnavailableError);
    }
    for (const store of [fs, db]) {
      expect(store.listProjects).not.toHaveBeenCalled();
      expect(store.loadProject).not.toHaveBeenCalled();
      expect(store.saveProject).not.toHaveBeenCalled();
      expect(store.loadSettings).not.toHaveBeenCalled();
    }
    expect(fs.removeLegacyApiKeyFiles).not.toHaveBeenCalled();
  });

  it('keeps the filesystem when only the legacy key cleanup fails', async () => {
    const { storageService, db } = await loadStorageService({
      tauri: true,
      configure: (double) =>
        double.removeLegacyApiKeyFiles.mockRejectedValue(new Error('cleanup failed')),
    });

    await expect(storageService.getProjectAuthority()).resolves.toBe('fs');
    await expect(storageService.listProjects()).resolves.toEqual(['fs-project']);
    expect(db.listProjects).not.toHaveBeenCalled();
  });

  it('keeps IndexedDB as the browser store', async () => {
    const { storageService, fs } = await loadStorageService({ tauri: false });

    await expect(storageService.getStorageBackendKind()).resolves.toBe('indexeddb');
    await expect(storageService.getProjectAuthority()).resolves.toBe('idb');
    await expect(storageService.listProjects()).resolves.toEqual(['idb-project']);
    expect(fs.initialize).not.toHaveBeenCalled();
  });
});
