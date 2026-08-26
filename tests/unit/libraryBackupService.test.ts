import { beforeEach, describe, expect, it, vi } from 'vitest';
import { charactersAdapter, worldsAdapter } from '../../features/project/adapters';
import type { ProjectData } from '../../features/project/projectSlice';
import {
  decryptLibraryInnerBytes,
  decryptLibraryZipBlob,
  encryptLibraryInnerBytes,
  LIBRARY_BACKUP_FORMAT,
} from '../../services/libraryBackupService';
import type { StoryProject } from '../../types';

vi.mock('../../services/storageService', () => ({
  storageService: {
    getStorageBackendKind: vi.fn(),
    listProjects: vi.fn(),
    loadProject: vi.fn(),
    getStoryCodex: vi.fn(),
    getRagVectors: vi.fn(),
    listBinderAssetIds: vi.fn(),
    getBinderAsset: vi.fn(),
    loadSettings: vi.fn(),
    listSnapshots: vi.fn(),
    getSnapshotData: vi.fn(),
  },
}));

const minimalProject = (): ProjectData => ({
  id: 'p1',
  title: 'Test',
  logline: 'L',
  characters: charactersAdapter.getInitialState(),
  worlds: worldsAdapter.getInitialState(),
  outline: [],
  manuscript: [],
});

describe('libraryBackupService crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encryptLibraryInnerBytes round-trips with decryptLibraryInnerBytes', async () => {
    const plain = new TextEncoder().encode('hello-library');
    const { salt, iv, ciphertext } = await encryptLibraryInnerBytes(plain, 'correct horse battery');
    const back = await decryptLibraryInnerBytes(ciphertext, 'correct horse battery', salt, iv);
    expect(new TextDecoder().decode(back)).toBe('hello-library');
  });

  it('rejects wrong passphrase', async () => {
    const plain = new TextEncoder().encode('secret');
    const { salt, iv, ciphertext } = await encryptLibraryInnerBytes(plain, 'pass-a');
    await expect(decryptLibraryInnerBytes(ciphertext, 'pass-b', salt, iv)).rejects.toThrow();
  });
});

describe('libraryBackupService zip roundtrip', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.getStorageBackendKind).mockResolvedValue('indexeddb');
    vi.mocked(storageService.listProjects).mockResolvedValue(['p1']);
    vi.mocked(storageService.loadProject).mockResolvedValue(
      minimalProject() as unknown as StoryProject,
    );
    vi.mocked(storageService.getStoryCodex).mockResolvedValue(null);
    vi.mocked(storageService.getRagVectors).mockResolvedValue([]);
    vi.mocked(storageService.listBinderAssetIds).mockResolvedValue([]);
    vi.mocked(storageService.loadSettings).mockResolvedValue(null);
    vi.mocked(storageService.listSnapshots).mockResolvedValue([]);
  });

  it('decryptLibraryZipBlob restores payload format', async () => {
    const { buildEncryptedLibraryZipBlob } = await import('../../services/libraryBackupService');
    const blob = await buildEncryptedLibraryZipBlob('zip-secret-pass');
    const parsed = await decryptLibraryZipBlob(blob, 'zip-secret-pass');
    expect(parsed.format).toBe(LIBRARY_BACKUP_FORMAT);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]?.projectId).toBe('p1');
  });
});

describe('libraryBackupService — partial corruption (DA-01)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.getStorageBackendKind).mockResolvedValue('filesystem');
    vi.mocked(storageService.listProjects).mockResolvedValue(['good', 'corrupt']);
    vi.mocked(storageService.loadProject).mockImplementation(async (projectId: string) => {
      if (projectId === 'corrupt') {
        throw new Error('The saved project file for "corrupt" appears to be corrupted.');
      }
      return minimalProject() as unknown as StoryProject;
    });
    vi.mocked(storageService.getStoryCodex).mockResolvedValue(null);
    vi.mocked(storageService.getRagVectors).mockResolvedValue([]);
    vi.mocked(storageService.listBinderAssetIds).mockResolvedValue([]);
    vi.mocked(storageService.loadSettings).mockResolvedValue(null);
    vi.mocked(storageService.listSnapshots).mockResolvedValue([]);
  });

  it('does not abort the whole backup when one project fails to load — the good project still backs up', async () => {
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');
    const payload = await collectLibraryBackupPayload();
    expect(payload.projects).toHaveLength(2);
    const good = payload.projects.find((p) => p.projectId === 'good');
    const corrupt = payload.projects.find((p) => p.projectId === 'corrupt');
    expect(good?.project).not.toBeNull();
    // QNBS-v3: the corrupt entry stays present with a null payload — the whole backup must not abort.
    expect(corrupt?.project).toBeNull();
  });
});
