import { beforeEach, describe, expect, it, vi } from 'vitest';
import { charactersAdapter, worldsAdapter } from '../../features/project/adapters';
import type { ProjectData } from '../../features/project/projectSlice';
import {
  decryptLibraryInnerBytes,
  decryptLibraryZipBlob,
  encryptLibraryInnerBytes,
  LIBRARY_BACKUP_FORMAT,
} from '../../services/libraryBackupService';

vi.mock('../../services/storageService', () => ({
  storageService: {
    getStorageBackendKind: vi.fn(),
    listProjects: vi.fn(),
    loadProject: vi.fn(),
    loadCanonicalProjectRaw: vi.fn(),
    getStoryCodex: vi.fn(),
    getRagVectors: vi.fn(),
    listBinderAssetIds: vi.fn(),
    getBinderAsset: vi.fn(),
    loadSettings: vi.fn(),
    listSnapshots: vi.fn(),
    getSnapshotData: vi.fn(),
    getSnapshotText: vi.fn(),
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

const minimalRaw = (): string => JSON.stringify({ ...minimalProject(), schemaVersion: 1 });

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
    vi.mocked(storageService.loadCanonicalProjectRaw).mockResolvedValue(minimalRaw());
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

  it('carries the stored canonical raw so opaque fields and exact numbers survive the backup', async () => {
    const { storageService } = await import('../../services/storageService');
    const portableRaw = minimalRaw().replace(
      /}$/,
      ',"futureWidget":{"k":1},"bigCount":9007199254740993}',
    );
    const storedRaw = portableRaw.replace(
      /}$/,
      ',"__worldscriptLegacyProjectDirectory":"old-dir","__worldscriptLegacyAuxiliary":{"a":1}}',
    );
    vi.mocked(storageService.loadCanonicalProjectRaw).mockResolvedValue(storedRaw);
    const { buildEncryptedLibraryZipBlob } = await import('../../services/libraryBackupService');

    const parsed = await decryptLibraryZipBlob(
      await buildEncryptedLibraryZipBlob('zip-secret-pass'),
      'zip-secret-pass',
    );

    // Exact stored text minus the two machine-local trust keys — in both representations.
    expect(parsed.projects[0]?.projectRaw).toBe(portableRaw);
    expect(parsed.projects[0]?.project).toMatchObject({ futureWidget: { k: 1 } });
    expect(parsed.projects[0]?.project).not.toHaveProperty('__worldscriptLegacyProjectDirectory');
    expect(parsed.projects[0]?.project).not.toHaveProperty('__worldscriptLegacyAuxiliary');
    expect(storageService.loadProject).not.toHaveBeenCalled();
  });
});

describe('libraryBackupService — partial corruption (DA-01)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.getStorageBackendKind).mockResolvedValue('filesystem');
    vi.mocked(storageService.getStoryCodex).mockResolvedValue(null);
    vi.mocked(storageService.getRagVectors).mockResolvedValue([]);
    vi.mocked(storageService.listBinderAssetIds).mockResolvedValue([]);
    vi.mocked(storageService.loadSettings).mockResolvedValue(null);
    vi.mocked(storageService.listSnapshots).mockResolvedValue([]);
  });

  it('does not abort the whole backup when one project is corrupt — the good project still backs up', async () => {
    const { storageService } = await import('../../services/storageService');
    const { ProjectLoadError } = await import('../../services/fs/projectFsStore');
    vi.mocked(storageService.listProjects).mockResolvedValue(['good', 'corrupt']);
    vi.mocked(storageService.loadCanonicalProjectRaw).mockImplementation(
      async (projectId: string) => {
        if (projectId === 'corrupt') {
          throw new ProjectLoadError(
            'corrupt',
            'The saved project file for "corrupt" is corrupted.',
            'corrupt',
          );
        }
        return minimalRaw();
      },
    );
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');
    const payload = await collectLibraryBackupPayload();
    expect(payload.projects).toHaveLength(2);
    const good = payload.projects.find((p) => p.projectId === 'good');
    const corrupt = payload.projects.find((p) => p.projectId === 'corrupt');
    expect(good?.project).not.toBeNull();
    // QNBS-v3: the corrupt entry stays present with a null payload — the whole backup must not abort.
    expect(corrupt?.project).toBeNull();
  });

  it('keeps a listed project whose stored text is absent as an empty entry', async () => {
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.listProjects).mockResolvedValue(['gone']);
    vi.mocked(storageService.loadCanonicalProjectRaw).mockResolvedValue(null);
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');
    const payload = await collectLibraryBackupPayload();
    expect(payload.projects[0]).toMatchObject({
      projectId: 'gone',
      project: null,
      projectRaw: null,
    });
  });

  // QNBS-v3: unsupported projects must never be represented as a successful backup with an omitted payload.
  it('fails visibly when a project uses an unsupported schema version', async () => {
    const { storageService } = await import('../../services/storageService');
    const { ProjectLoadError } = await import('../../services/fs/projectFsStore');
    vi.mocked(storageService.listProjects).mockResolvedValue(['future']);
    vi.mocked(storageService.loadCanonicalProjectRaw).mockRejectedValue(
      new ProjectLoadError(
        'unsupported-version',
        'The saved project uses a schema version this build cannot edit.',
        'future',
        'FUTURE',
      ),
    );
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');
    await expect(collectLibraryBackupPayload()).rejects.toMatchObject({
      reason: 'unsupported-version',
      projectId: 'future',
    });
  });

  // QNBS-v3 (codex P1): an unexpected (non-ProjectLoadError) failure must still surface, not be silently swallowed as if it were an ordinary corrupt project.
  it('rethrows an unexpected (non-ProjectLoadError) failure instead of silently swallowing it', async () => {
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.listProjects).mockResolvedValue(['ok', 'buggy']);
    vi.mocked(storageService.loadCanonicalProjectRaw).mockImplementation(
      async (projectId: string) => {
        if (projectId === 'buggy') {
          throw new TypeError('Cannot read properties of undefined (a genuine programming bug)');
        }
        return minimalRaw();
      },
    );
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');
    await expect(collectLibraryBackupPayload()).rejects.toThrow(TypeError);
  });
});

describe('libraryBackupService snapshot egress (#553 a11)', () => {
  const snap = (id: number) => ({ id, date: '2026-09-25', name: `s${id}`, wordCount: 1 });
  const exactSnapshotText =
    '{"schemaVersion":1,"id":"p1","title":"Snap","logline":"L","characters":[],"worlds":[],"manuscript":[],' +
    '"exact":9007199254740993,"opaque":{"nested":[1,2]},' +
    '"__worldscriptLegacyProjectDirectory":"local-dir","__worldscriptLegacyAuxiliary":{"k":1}}';

  beforeEach(async () => {
    vi.clearAllMocks();
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.getStorageBackendKind).mockResolvedValue('filesystem');
    vi.mocked(storageService.listProjects).mockResolvedValue(['p1']);
    vi.mocked(storageService.loadCanonicalProjectRaw).mockResolvedValue(minimalRaw());
    vi.mocked(storageService.getStoryCodex).mockResolvedValue(null);
    vi.mocked(storageService.getRagVectors).mockResolvedValue([]);
    vi.mocked(storageService.listBinderAssetIds).mockResolvedValue([]);
    vi.mocked(storageService.loadSettings).mockResolvedValue(null);
  });

  it('exports the stored snapshot text exactly, opaque fields kept, local metadata removed', async () => {
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.listSnapshots).mockResolvedValue([snap(1)]);
    vi.mocked(storageService.getSnapshotText).mockResolvedValue(exactSnapshotText);
    const { buildEncryptedLibraryZipBlob } = await import('../../services/libraryBackupService');

    const parsed = await decryptLibraryZipBlob(
      await buildEncryptedLibraryZipBlob('pw-a11'),
      'pw-a11',
    );

    const entry = parsed.snapshots[0];
    expect(entry?.dataRaw).toContain('"exact":9007199254740993');
    expect(entry?.dataRaw).toContain('"opaque":{"nested":[1,2]}');
    expect(entry?.dataRaw).not.toContain('__worldscriptLegacy');
    expect(entry?.data).not.toHaveProperty('__worldscriptLegacyProjectDirectory');
    expect(entry?.data).not.toHaveProperty('__worldscriptLegacyAuxiliary');
    expect(storageService.getSnapshotData).not.toHaveBeenCalled();
    // Project entries (a2) are unchanged.
    expect(parsed.projects[0]?.projectRaw).toBe(minimalRaw());
  });

  it('keeps a supported older (unversioned) snapshot exportable as stored', async () => {
    const { storageService } = await import('../../services/storageService');
    const legacy = '{"title":"Old","logline":"L","characters":[],"worlds":[],"manuscript":[]}';
    vi.mocked(storageService.listSnapshots).mockResolvedValue([snap(2)]);
    vi.mocked(storageService.getSnapshotText).mockResolvedValue(legacy);
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');

    const payload = await collectLibraryBackupPayload();

    expect(payload.snapshots[0]?.dataRaw).toBe(legacy);
  });

  it('records one unexportable snapshot as not exported without aborting the backup', async () => {
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.listSnapshots).mockResolvedValue([
      snap(3),
      snap(4),
      snap(6),
      snap(7),
      snap(5),
    ]);
    vi.mocked(storageService.getSnapshotText).mockImplementation(async (id: number) => {
      if (id === 3) return '{"schemaVersion":99,"title":"Future"}';
      if (id === 4) throw new Error('snapshot read failed');
      if (id === 6) return null;
      if (id === 7) return '[1,2]';
      return exactSnapshotText;
    });
    const { collectLibraryBackupPayload } = await import('../../services/libraryBackupService');

    const payload = await collectLibraryBackupPayload();

    expect(payload.snapshots.map((s) => s.dataRaw === null)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(payload.snapshots.map((s) => s.data === null)).toEqual([true, true, true, true, false]);
    expect(payload.snapshots.map((s) => s.name)).toEqual(['s3', 's4', 's6', 's7', 's5']);
    expect(payload.projects).toHaveLength(1);
  });

  it('decodes an archive written before snapshot carriers existed without inventing one', async () => {
    const { storageService } = await import('../../services/storageService');
    vi.mocked(storageService.getStorageBackendKind).mockResolvedValue('indexeddb');
    vi.mocked(storageService.listSnapshots).mockResolvedValue([]);
    const JSZip = (await import('jszip')).default;
    const legacyPayload = {
      format: LIBRARY_BACKUP_FORMAT,
      exportedAt: '2026-01-01T00:00:00.000Z',
      storageBackend: 'indexeddb',
      settings: null,
      projects: [],
      snapshots: [{ id: 1, date: 'd', name: 'old', wordCount: 0, data: { title: 'Old' } }],
    };
    const inner = new JSZip();
    inner.file('payload.json', JSON.stringify(legacyPayload));
    const innerBytes = await inner.generateAsync({ type: 'uint8array' });
    const { salt, iv, ciphertext } = await encryptLibraryInnerBytes(innerBytes, 'pw-old');
    const outer = new JSZip();
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    outer.file(
      'META.json',
      JSON.stringify({
        format: LIBRARY_BACKUP_FORMAT,
        kdf: 'PBKDF2-SHA256',
        iterations: 600000,
        saltBase64: b64(salt),
        ivBase64: b64(iv),
        cipher: 'AES-GCM-256',
      }),
    );
    outer.file('vault.bin', ciphertext);

    const parsed = await decryptLibraryZipBlob(
      await outer.generateAsync({ type: 'blob' }),
      'pw-old',
    );

    expect(parsed.snapshots[0]?.data).toEqual({ title: 'Old' });
    expect(parsed.snapshots[0]).not.toHaveProperty('dataRaw');
  });
});
