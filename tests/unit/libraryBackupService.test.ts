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
