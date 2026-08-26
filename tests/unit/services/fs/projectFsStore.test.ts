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
    await expect(promise).rejects.toMatchObject({ reason: 'io-error' });
  });

  it('throws ProjectLoadError("corrupt") on a corrupt/truncated compressed payload', async () => {
    const { FsProjectStore, ProjectLoadError } = await import(
      '../../../../services/fs/projectFsStore'
    );
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue('\x00lz1\x00@@not-valid@@');
    const store = new FsProjectStore();
    const promise = store.loadProject('corrupt-id');
    await expect(promise).rejects.toThrow(ProjectLoadError);
    await expect(promise).rejects.toMatchObject({ reason: 'corrupt' });
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

  it('resolves the real project on a valid save with array-shaped characters/worlds', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    const validProject = {
      title: 'My Book',
      logline: 'L',
      characters: [],
      worlds: [],
      manuscript: [],
    };
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(compressData(validProject));
    const store = new FsProjectStore();
    await expect(store.loadProject('good-id')).resolves.toEqual(validProject);
  });

  it('resolves the real project on a valid save with EntityState-shaped characters/worlds', async () => {
    const { FsProjectStore } = await import('../../../../services/fs/projectFsStore');
    const validProject = {
      title: 'My Book',
      logline: 'L',
      characters: { ids: [], entities: {} },
      worlds: { ids: [], entities: {} },
      manuscript: [],
    };
    mockDesktopPlatform.filesystem.exists.mockResolvedValue(true);
    mockDesktopPlatform.filesystem.readTextFile.mockResolvedValue(compressData(validProject));
    const store = new FsProjectStore();
    await expect(store.loadProject('good-entity-state-id')).resolves.toEqual(validProject);
  });
});
