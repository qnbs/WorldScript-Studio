import { beforeEach, describe, expect, it, vi } from 'vitest';
import { charactersAdapter, worldsAdapter } from '../../features/project/adapters';
import { saveEnvelopeFromProjectData } from '../../services/storageBackend';

// Mock both backends before importing storageService
const mockDb = {
  saveProject: vi.fn().mockResolvedValue(undefined),
  loadProject: vi.fn().mockResolvedValue(null),
  listProjects: vi.fn().mockResolvedValue([]),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  saveImage: vi.fn().mockResolvedValue(undefined),
  getImage: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  loadSettings: vi.fn().mockResolvedValue(null),
  saveGeminiApiKey: vi.fn().mockResolvedValue(undefined),
  getGeminiApiKey: vi.fn().mockResolvedValue(null),
  clearGeminiApiKey: vi.fn().mockResolvedValue(undefined),
  saveApiKey: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue(null),
  clearApiKey: vi.fn().mockResolvedValue(undefined),
  removeLegacyApiKeyFiles: vi.fn().mockResolvedValue(undefined),
  saveSnapshot: vi.fn().mockResolvedValue(1),
  getSnapshotData: vi.fn().mockResolvedValue(null),
  listSnapshots: vi.fn().mockResolvedValue([]),
  deleteSnapshot: vi.fn().mockResolvedValue(undefined),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  hasSavedData: vi.fn().mockResolvedValue(false),
  saveStoryCodex: vi.fn().mockResolvedValue(undefined),
  getStoryCodex: vi.fn().mockResolvedValue(null),
  deleteStoryCodex: vi.fn().mockResolvedValue(undefined),
  saveRagVectors: vi.fn().mockResolvedValue(undefined),
  getRagVectors: vi.fn().mockResolvedValue([]),
  deleteRagVectors: vi.fn().mockResolvedValue(undefined),
  deleteQualifiedImage: vi.fn().mockResolvedValue(undefined),
  saveBinderAsset: vi.fn().mockResolvedValue(undefined),
  deleteBinderAsset: vi.fn().mockResolvedValue(undefined),
  deleteAllBinderAssetsForProject: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../services/dbService', () => ({ dbService: mockDb }));
vi.mock('../../services/fileSystemService', () => ({
  fileSystemService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    ...mockDb,
  },
}));

describe('storageService (IndexedDB backend in browser)', () => {
  let storageService: Awaited<typeof import('../../services/storageService')>['storageService'];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Ensure no Tauri context
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    const mod = await import('../../services/storageService');
    storageService = mod.storageService;
  });

  it('delegates saveProject to dbService', async () => {
    const payload = saveEnvelopeFromProjectData({
      id: 'p1',
      title: 'T',
      logline: 'L',
      characters: charactersAdapter.getInitialState(),
      worlds: worldsAdapter.getInitialState(),
      outline: [],
      manuscript: [],
    });
    await storageService.saveProject(payload);
    expect(mockDb.saveProject).toHaveBeenCalledWith(payload);
  });

  it('delegates loadProject to dbService', async () => {
    mockDb.loadProject.mockResolvedValueOnce({ id: 'p1', data: { title: 'Test' } });
    const result = await storageService.loadProject('p1');
    expect(mockDb.loadProject).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ id: 'p1', data: { title: 'Test' } });
  });

  it('delegates listProjects to dbService', async () => {
    mockDb.listProjects.mockResolvedValueOnce(['p1', 'p2']);
    const result = await storageService.listProjects();
    expect(result).toEqual(['p1', 'p2']);
  });

  it('delegates deleteProject to dbService', async () => {
    await storageService.deleteProject('p1');
    expect(mockDb.deleteProject).toHaveBeenCalledWith('p1');
  });

  // QNBS-v3 (#332): getActiveProjectId is optional on StorageBackend — dbService/IndexedDB has no multi-project ambiguity to resolve, so this must not throw when the backend doesn't implement it.
  it('returns null for getActiveProjectId when the backend does not implement it', async () => {
    expect(await storageService.getActiveProjectId()).toBeNull();
  });

  // QNBS-v3: unsupported IndexedDB quarantine must remain a safe no-op rather than inventing a filesystem path.
  it('returns null when the IndexedDB backend does not support filesystem quarantine', async () => {
    await expect(storageService.quarantineProject('project-1')).resolves.toBeNull();
  });

  it('delegates saveSettings / loadSettings to dbService', async () => {
    await storageService.saveSettings({} as never);
    expect(mockDb.saveSettings).toHaveBeenCalled();

    await storageService.loadSettings();
    expect(mockDb.loadSettings).toHaveBeenCalled();
  });

  it('delegates Gemini API key operations to dbService', async () => {
    await storageService.saveGeminiApiKey('sk-test');
    expect(mockDb.saveGeminiApiKey).toHaveBeenCalledWith('sk-test');

    await storageService.getGeminiApiKey();
    expect(mockDb.getGeminiApiKey).toHaveBeenCalled();

    await storageService.clearGeminiApiKey();
    expect(mockDb.clearGeminiApiKey).toHaveBeenCalled();
  });

  it('delegates generic API key operations to dbService', async () => {
    await storageService.saveApiKey('openai', 'key');
    expect(mockDb.saveApiKey).toHaveBeenCalledWith('openai', 'key');

    await storageService.getApiKey('openai');
    expect(mockDb.getApiKey).toHaveBeenCalledWith('openai');

    await storageService.clearApiKey('openai');
    expect(mockDb.clearApiKey).toHaveBeenCalledWith('openai');
  });

  it('keeps API keys on IndexedDB when the desktop filesystem backend is active', async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.resetModules();
    // QNBS-v3: Desktop project storage must not redirect API keys to filesystem persistence.
    const desktopStorage = (await import('../../services/storageService')).storageService;

    await desktopStorage.saveApiKey('openai', 'desktop-key');
    await desktopStorage.getApiKey('openai');
    await desktopStorage.clearApiKey('openai');

    expect(mockDb.saveApiKey).toHaveBeenCalledWith('openai', 'desktop-key');
    expect(mockDb.getApiKey).toHaveBeenCalledWith('openai');
    expect(mockDb.clearApiKey).toHaveBeenCalledWith('openai');
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it('delegates snapshot operations to dbService', async () => {
    mockDb.saveSnapshot.mockResolvedValueOnce(42);
    const id = await storageService.saveSnapshot('label', { data: 1 });
    expect(id).toBe(42);

    await storageService.getSnapshotData(42);
    expect(mockDb.getSnapshotData).toHaveBeenCalledWith(42);

    const currentProject = { id: 'p1', title: 'Current target' };
    await storageService.restoreSnapshot(42, currentProject as never);
    expect(mockDb.getSnapshotData).toHaveBeenCalledWith(42);

    await storageService.listSnapshots();
    expect(mockDb.listSnapshots).toHaveBeenCalled();

    await storageService.deleteSnapshot(42);
    expect(mockDb.deleteSnapshot).toHaveBeenCalledWith(42);
  });

  it('delegates Story Codex operations to dbService', async () => {
    const codex = { projectId: 'p1', extractedAt: '', summary: '', entities: [] };
    await storageService.saveStoryCodex(codex as never);
    expect(mockDb.saveStoryCodex).toHaveBeenCalledWith(codex);

    await storageService.getStoryCodex('p1');
    expect(mockDb.getStoryCodex).toHaveBeenCalledWith('p1');

    await storageService.deleteStoryCodex('p1');
    expect(mockDb.deleteStoryCodex).toHaveBeenCalledWith('p1');
  });

  it('delegates RAG vector operations to dbService', async () => {
    const vectors = [{ id: 'v1', embedding: [0.1, 0.2] }];
    await storageService.saveRagVectors('p1', vectors);
    expect(mockDb.saveRagVectors).toHaveBeenCalledWith('p1', vectors);

    await storageService.getRagVectors('p1');
    expect(mockDb.getRagVectors).toHaveBeenCalledWith('p1');

    await storageService.deleteRagVectors('p1');
    expect(mockDb.deleteRagVectors).toHaveBeenCalledWith('p1');
  });

  it('delegates hasSavedData and deleteImage to dbService', async () => {
    mockDb.hasSavedData.mockResolvedValueOnce(true);
    const result = await storageService.hasSavedData();
    expect(result).toBe(true);

    await storageService.deleteImage('img-1', 'proj-1');
    expect(mockDb.deleteImage).toHaveBeenCalledWith('img-1', 'proj-1');
  });

  it('reports indexeddb storage backend in web context', async () => {
    await expect(storageService.getStorageBackendKind()).resolves.toBe('indexeddb');
  });
});

// QNBS-v3: a refused desktop project must stay untouched through EVERY project-scoped write — not only the project document — so the fence lives at the storage boundary itself.
describe('storageService safe-session fence', () => {
  let storageService: Awaited<typeof import('../../services/storageService')>['storageService'];
  let session: typeof import('../../services/startupSafeSession');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    session = await import('../../services/startupSafeSession');
    storageService = (await import('../../services/storageService')).storageService;
  });

  const projectOf = (id: string) =>
    saveEnvelopeFromProjectData({
      id,
      title: 'T',
      logline: 'L',
      characters: charactersAdapter.getInitialState(),
      worlds: worldsAdapter.getInitialState(),
      outline: [],
      manuscript: [],
    });

  // [label, invoke, backend spy] — every entry targets the refused namespace ('default'), directly or by an unset projectId.
  const refusedWrites: Array<
    [string, (s: typeof storageService) => Promise<unknown>, () => ReturnType<typeof vi.fn>]
  > = [
    ['saveProject', (s) => s.saveProject(projectOf('default')), () => mockDb.saveProject],
    ['deleteProject', (s) => s.deleteProject('default'), () => mockDb.deleteProject],
    ['saveImage (explicit)', (s) => s.saveImage('i', 'b', 'default'), () => mockDb.saveImage],
    ['saveImage (unset id => default)', (s) => s.saveImage('i', 'b'), () => mockDb.saveImage],
    ['deleteImage (unset id => default)', (s) => s.deleteImage('i'), () => mockDb.deleteImage],
    [
      'deleteQualifiedImage',
      (s) => s.deleteQualifiedImage('i', 'default'),
      () => mockDb.deleteQualifiedImage,
    ],
    [
      'saveStoryCodex',
      (s) => s.saveStoryCodex({ projectId: 'default' } as never),
      () => mockDb.saveStoryCodex,
    ],
    ['deleteStoryCodex', (s) => s.deleteStoryCodex('default'), () => mockDb.deleteStoryCodex],
    ['saveRagVectors', (s) => s.saveRagVectors('default', []), () => mockDb.saveRagVectors],
    ['deleteRagVectors', (s) => s.deleteRagVectors('default'), () => mockDb.deleteRagVectors],
    [
      'saveBinderAsset',
      (s) => s.saveBinderAsset('default', 'a', new ArrayBuffer(1), {} as never),
      () => mockDb.saveBinderAsset,
    ],
    [
      'deleteBinderAsset',
      (s) => s.deleteBinderAsset('default', 'a'),
      () => mockDb.deleteBinderAsset,
    ],
    [
      'deleteAllBinderAssetsForProject',
      (s) => s.deleteAllBinderAssetsForProject('default'),
      () => mockDb.deleteAllBinderAssetsForProject,
    ],
  ];

  it('passes every project-scoped write straight through outside a safe session', async () => {
    await storageService.saveImage('i', 'b', 'default');
    await storageService.deleteProject('default');
    expect(mockDb.saveImage).toHaveBeenCalledOnce();
    expect(mockDb.deleteProject).toHaveBeenCalledOnce();
  });

  it.each(refusedWrites)(
    'never lets %s reach the refused namespace in a safe session',
    async (_label, invoke, spy) => {
      session.enterSafeSession('default');
      await expect(invoke(storageService)).rejects.toBeInstanceOf(
        session.ProjectPersistenceFencedError,
      );
      expect(spy()).not.toHaveBeenCalled();
    },
  );

  it('admits the session identity for namespace writes, and its project document only once established', async () => {
    session.enterSafeSession('default');
    const identity = session.getSafeSessionProjectId() ?? '';

    await storageService.saveImage('i', 'b', identity);
    expect(mockDb.saveImage).toHaveBeenCalledWith('i', 'b', identity);

    await expect(storageService.saveProject(projectOf(identity))).rejects.toBeInstanceOf(
      session.ProjectPersistenceFencedError,
    );
    expect(mockDb.saveProject).not.toHaveBeenCalled();

    session.establishSafeSessionProject(identity, () => undefined);
    await storageService.saveProject(projectOf(identity));
    expect(mockDb.saveProject).toHaveBeenCalledOnce();
    await expect(storageService.saveProject(projectOf('default'))).rejects.toBeInstanceOf(
      session.ProjectPersistenceFencedError,
    );
  });
});
