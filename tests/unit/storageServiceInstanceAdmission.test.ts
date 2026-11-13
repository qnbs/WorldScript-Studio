import { afterEach, describe, expect, it, vi } from 'vitest';

// #831: the desktop backend admits no reader or writer before the app-data writers admission has run,
// because a crash-left project lock is reclaimed only then, while no lock of this process can exist yet.
function backendDouble() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    removeLegacyApiKeyFiles: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn().mockResolvedValue(['p1']),
    saveProject: vi.fn().mockResolvedValue(undefined),
  };
}

async function loadStorageService(options: {
  tauri: boolean;
  admit: () => Promise<unknown>;
  configure?: (fs: ReturnType<typeof backendDouble>) => void;
}) {
  vi.resetModules();
  const fs = backendDouble();
  options.configure?.(fs);
  const admitAppDataInstance = vi.fn(options.admit);
  vi.doMock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => options.tauri }));
  vi.doMock('../../services/fileSystemService', () => ({ fileSystemService: fs }));
  vi.doMock('../../services/dbService', () => ({ dbService: backendDouble() }));
  vi.doMock('../../services/desktopPlatform', () => ({
    desktopPlatform: { persistence: { admitAppDataInstance } },
  }));
  const { storageService } = await import('../../services/storageService');
  return { storageService, fs, admitAppDataInstance };
}

afterEach(() => {
  vi.doUnmock('../../services/tauriRuntime');
  vi.doUnmock('../../services/fileSystemService');
  vi.doUnmock('../../services/dbService');
  vi.doUnmock('../../services/desktopPlatform');
});

describe('desktop app-data writers admission (#831)', () => {
  it('runs after the filesystem opens and before the first project access', async () => {
    let admitted!: () => void;
    const admission = new Promise<unknown>((resolve) => {
      admitted = () => resolve({ status: 'exclusive', reclaimed: 1 });
    });
    const { storageService, fs, admitAppDataInstance } = await loadStorageService({
      tauri: true,
      admit: () => admission,
    });

    const listing = storageService.listProjects();
    await vi.waitFor(() => expect(admitAppDataInstance).toHaveBeenCalledTimes(1));
    expect(fs.initialize.mock.invocationCallOrder[0]).toBeLessThan(
      admitAppDataInstance.mock.invocationCallOrder[0]!,
    );
    expect(fs.listProjects).not.toHaveBeenCalled();
    expect(fs.removeLegacyApiKeyFiles).not.toHaveBeenCalled();

    admitted();
    await expect(listing).resolves.toEqual(['p1']);
  });

  it('keeps desktop storage working when another writer is alive (shared)', async () => {
    const { storageService, fs } = await loadStorageService({
      tauri: true,
      admit: async () => ({ status: 'shared', reclaimed: 0 }),
    });
    await expect(storageService.listProjects()).resolves.toEqual(['p1']);
    await expect(storageService.getProjectAuthority()).resolves.toBe('fs');
    expect(fs.listProjects).toHaveBeenCalled();
  });

  // Without the shared writers lock, a later process could reclaim this one's live project locks.
  it.each([
    ['unavailable', async () => ({ status: 'unavailable', reclaimed: 0, detail: 'no lock' })],
    ['a rejected admission', async () => Promise.reject(new Error('bridge gone'))],
  ])('refuses every desktop storage access when the admission is %s', async (_label, admit) => {
    const { storageService, fs } = await loadStorageService({ tauri: true, admit });
    await expect(storageService.listProjects()).rejects.toMatchObject({
      name: 'DesktopStorageAuthorityUnavailableError',
    });
    await expect(storageService.saveProject({ data: { id: 'p1' } } as never)).rejects.toMatchObject(
      {
        name: 'DesktopStorageAuthorityUnavailableError',
      },
    );
    expect(fs.listProjects).not.toHaveBeenCalled();
    expect(fs.saveProject).not.toHaveBeenCalled();
  });

  it('is not attempted when the desktop filesystem cannot be opened', async () => {
    const { storageService, admitAppDataInstance } = await loadStorageService({
      tauri: true,
      admit: async () => ({ status: 'exclusive', reclaimed: 0 }),
      configure: (double) => double.initialize.mockRejectedValue(new Error('permission denied')),
    });
    await expect(storageService.listProjects()).rejects.toThrow();
    expect(admitAppDataInstance).not.toHaveBeenCalled();
  });

  it('is never attempted in the web build', async () => {
    const { storageService, admitAppDataInstance } = await loadStorageService({
      tauri: false,
      admit: async () => ({ status: 'unavailable', reclaimed: 0 }),
    });
    await storageService.listProjects();
    expect(admitAppDataInstance).not.toHaveBeenCalled();
  });
});
