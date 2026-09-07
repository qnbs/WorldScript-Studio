/**
 * Tests for services/fs/projectFsStore.ts#loadProject — DA-01 fail-closed corruption/I-O semantics.
 * Genuine absence must still resolve to null; corruption or I/O failure must throw ProjectLoadError
 * instead of silently collapsing into the same null a caller could mistake for "no saved project".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compressData } from '../../../../services/fs/fsCore';

// QNBS-v3: FsCore.getApis()'s own in-module loadTauriApis() call bypasses a mock of fsCore.ts — mock desktopPlatform one level down instead.
const { mockDesktopPlatform } = vi.hoisted(() => ({
  mockDesktopPlatform: {
    runtime: { isDesktop: true },
    filesystem: {
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      exists: vi.fn(),
      readDir: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
    },
    dialogs: { openFilePicker: vi.fn(), saveFilePicker: vi.fn() },
    persistence: {
      appDataDir: vi.fn().mockResolvedValue('/fake/appdata'),
      join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
    },
  },
}));

vi.mock('../../../../services/desktopPlatform', () => ({ desktopPlatform: mockDesktopPlatform }));

vi.mock('../../../../services/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/logger')>();
  return { ...actual, logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } };
});

vi.mock('../../../../features/project/coreValidationShadow', () => ({
  scheduleCoreProjectValidation: vi.fn(),
}));

describe('FsProjectStore.loadProject — DA-01 fail-closed behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for a genuinely missing project file (legitimate absence, unchanged)', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(false);
    const store = new FsProjectStore();
    await expect(store.loadProject('missing-id')).resolves.toBeNull();
  });

  // QNBS-v3: preserve the affected project identity when filesystem reads fail during recovery.
  it('throws ProjectLoadError("io-error") on a read failure instead of returning null', async () => {
    const { FsProjectStore, ProjectLoadError } = await import(
      '../../../../services/fs/projectFsStore'
    );
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockRejectedValue(
      new Error('EACCES: permission denied'),
    );
    const store = new FsProjectStore();
    const promise = store.loadProject('locked-id');
    await expect(promise).rejects.toThrow(ProjectLoadError);
    await expect(promise).rejects.toMatchObject({ reason: 'io-error', projectId: 'locked-id' });
  });

  // QNBS-v3: keep corruption classification attached to the project so quarantine targets only it.
  it('throws ProjectLoadError("corrupt") on a corrupt/truncated compressed payload', async () => {
    const { FsProjectStore, ProjectLoadError } = await import(
      '../../../../services/fs/projectFsStore'
    );
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue('\x00lz1\x00@@not-valid@@');
    const store = new FsProjectStore();
    const promise = store.loadProject('corrupt-id');
    await expect(promise).rejects.toThrow(ProjectLoadError);
    await expect(promise).rejects.toMatchObject({ reason: 'corrupt', projectId: 'corrupt-id' });
  });

  it('throws ProjectLoadError("corrupt") on valid JSON that is not project-shaped at all', async () => {
    const { FsProjectStore, ProjectLoadError } = await import(
      '../../../../services/fs/projectFsStore'
    );
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(
      JSON.stringify({ notAProject: true }),
    );
    const store = new FsProjectStore();
    const promise = store.loadProject('wrong-shape-id');
    await expect(promise).rejects.toThrow(ProjectLoadError);
    await expect(promise).rejects.toMatchObject({ reason: 'corrupt' });
  });

  // QNBS-v3 (CodeAnt/CodeRabbit): the guard previously accepted this truncated shape — logline/characters/worlds are also required.
  it('throws ProjectLoadError("corrupt") on a truncated project missing logline/characters/worlds', async () => {
    const { FsProjectStore, ProjectLoadError } = await import(
      '../../../../services/fs/projectFsStore'
    );
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(
      JSON.stringify({ title: 'x', manuscript: [] }),
    );
    const store = new FsProjectStore();
    const promise = store.loadProject('truncated-id');
    await expect(promise).rejects.toThrow(ProjectLoadError);
    await expect(promise).rejects.toMatchObject({ reason: 'corrupt' });
  });

  // QNBS-v3 (codex/CodeRabbit): exists() rejecting (not just resolving false) must classify as io-error too.
  it('throws ProjectLoadError("io-error") when the existence probe itself rejects', async () => {
    const { FsProjectStore, ProjectLoadError } = await import(
      '../../../../services/fs/projectFsStore'
    );
    mockDesktopPlatform.filesystem.exists.mockRejectedValue(new Error('EACCES: stat failed'));
    const store = new FsProjectStore();
    const promise = store.loadProject('unreadable-dir-id');
    await expect(promise).rejects.toThrow(ProjectLoadError);
    await expect(promise).rejects.toMatchObject({ reason: 'io-error' });
  });

  // QNBS-v3: explicit V1 admission keeps this source writable while legacy sources remain fenced.
  it('resolves the real project on a valid save with array-shaped characters/worlds', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    const validProject = {
      schemaVersion: 1,
      title: 'My Book',
      logline: 'L',
      characters: [],
      worlds: [],
      manuscript: [],
    };
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(compressData(validProject));
    const store = new FsProjectStore();
    await expect(store.loadProject('good-id')).resolves.toMatchObject({
      ...validProject,
      schemaVersion: 1,
    });
  });

  // QNBS-v3: EntityState-shaped V1 data remains editable after canonical admission.
  it('resolves the real project on a valid save with EntityState-shaped characters/worlds', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    const validProject = {
      schemaVersion: 1,
      title: 'My Book',
      logline: 'L',
      characters: { ids: [], entities: {} },
      worlds: { ids: [], entities: {} },
      manuscript: [],
    };
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(compressData(validProject));
    const store = new FsProjectStore();
    await expect(store.loadProject('good-entity-state-id')).resolves.toMatchObject({
      ...validProject,
      schemaVersion: 1,
    });
  });

  // QNBS-v3: current filesystem admission must reject malformed owned children before editable authority.
  it.each([
    ['entity', { characters: [{ id: 'c1', name: 42 }] }],
    ['manuscript entry', { manuscript: [{ id: 's1', title: 42, content: 'text' }] }],
  ])('rejects malformed nested %s content', async (_label, fragment) => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(
      JSON.stringify({
        title: 'Malformed nested',
        logline: 'L',
        characters: [],
        worlds: [],
        manuscript: [],
        ...fragment,
      }),
    );
    const store = new FsProjectStore();
    await expect(store.loadProject('malformed-nested-id')).rejects.toMatchObject({
      name: 'ProjectLoadError',
      reason: 'corrupt',
      classification: 'MALFORMED',
    });
  });

  // QNBS-v3: legacy admission must not stamp or rewrite a source before durable migration fencing exists.
  it('admits a legacy project in memory without rewriting its source', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    const source =
      '{"title":"Legacy book","logline":"L","characters":[],"worlds":[],"manuscript":[],"opaque":{"exact":9007199254740993}}';
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(source);
    const store = new FsProjectStore();

    const loaded = await store.loadProject('legacy-id');
    expect(loaded).toMatchObject({
      title: 'Legacy book',
      logline: 'L',
      characters: [],
      worlds: [],
      manuscript: [],
    });
    expect(loaded).not.toHaveProperty('schemaVersion');
    expect(mockDesktopPlatform.filesystem.writeTextFile).not.toHaveBeenCalled();
    expect(mockDesktopPlatform.filesystem.rename).not.toHaveBeenCalled();
  });

  // QNBS-v3: legacy admission cannot let ordinary autosave normalize or rewrite its source before fencing.
  it('rejects ordinary writeback after admitting a legacy project', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    const source =
      '{"title":"Legacy book","logline":"L","characters":[],"worlds":[],"manuscript":[]}';
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(source);
    const store = new FsProjectStore();

    const loaded = await store.loadProject('legacy-id');
    await expect(
      store.saveProject({ ...loaded, title: 'Edited legacy book' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectWritebackError',
      projectId: 'legacy-id',
    });
    expect(mockDesktopPlatform.filesystem.writeTextFile).not.toHaveBeenCalled();
  });

  // QNBS-v3: unsupported versions must refuse editable filesystem authority without touching source.
  it.each([
    ['future', { schemaVersion: 99, title: 'Future' }, 'FUTURE'],
    ['migration gap', { schemaVersion: 0, title: 'Gap' }, 'UNSUPPORTED_OLDER'],
  ])(
    'refuses %s filesystem input without changing its source',
    async (_label, value, classification) => {
      const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
      const source = JSON.stringify(value);
      mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
      mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(source);
      const store = new FsProjectStore();

      await expect(store.loadProject('refused-id')).rejects.toMatchObject({
        name: 'ProjectLoadError',
        reason: 'unsupported-version',
        projectId: 'refused-id',
        classification,
      });
      expect(mockDesktopPlatform.filesystem.writeTextFile).not.toHaveBeenCalled();
      expect(mockDesktopPlatform.filesystem.rename).not.toHaveBeenCalled();
    },
  );
});
