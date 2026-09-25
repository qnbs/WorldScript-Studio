/**
 * Tests for the services/fs/ Tauri filesystem store chain
 * (FsProjectStore → FsAssetStore → FsSnapshotStore → FsCodexStore → FsSettingsStore → FsCore).
 * QNBS-v3 (Phase 2): an in-memory fake `TauriApis` drives real round-trips (compress, AES-GCM
 * key encryption, JSON) through the real store logic — only `desktopPlatform` is mocked
 * (Wave 1 PR B: loadTauriApis now delegates through desktopPlatform instead of importing
 * @tauri-apps/* plugin modules directly).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';

// QNBS-v3: typed via `unknown` (not `any`) so the mock factories see a non-null TauriApis; the
// real value is set in beforeEach before any mock is invoked.
const { fsHolder, shadowValidation } = vi.hoisted(() => ({
  fsHolder: { current: null as unknown as TauriApis },
  shadowValidation: vi.fn(),
}));

// QNBS-v3: mocks desktopPlatform, not the raw @tauri-apps/* modules, so the REAL loadTauriApis assembles a TauriApis delegating to the per-test in-memory fake FS — exercises loadTauriApis itself too.
vi.mock('../../../../services/desktopPlatform', () => ({
  get desktopPlatform() {
    return {
      runtime: { isDesktop: true, os: null },
      filesystem: {
        readTextFile: (p: string) => fsHolder.current.readTextFile(p),
        writeTextFile: (p: string, c: string, opts?: { createNew?: boolean }) =>
          fsHolder.current.writeTextFile(p, c, opts),
        readFile: (p: string) => fsHolder.current.readFile(p),
        writeFile: (p: string, d: Uint8Array) => fsHolder.current.writeFile(p, d),
        mkdir: (p: string, opts?: { recursive?: boolean }) => fsHolder.current.mkdir(p, opts),
        exists: (p: string) => fsHolder.current.exists(p),
        readDir: (p: string) => fsHolder.current.readDir(p),
        remove: (p: string, opts?: { recursive?: boolean }) => fsHolder.current.remove(p, opts),
        rename: (from: string, to: string) => fsHolder.current.rename(from, to),
      },
      dialogs: {
        openFilePicker: (opts?: Record<string, unknown>) => fsHolder.current.open(opts),
        saveFilePicker: (opts?: Record<string, unknown>) => fsHolder.current.save(opts),
      },
      persistence: {
        appDataDir: () => fsHolder.current.appDataDir(),
        join: (...parts: string[]) => fsHolder.current.join(...parts),
      },
    };
  },
}));
vi.mock('../../../../features/project/coreValidationShadow', () => ({
  scheduleCoreProjectValidation: shadowValidation,
}));
vi.mock('../../../../services/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/logger')>();
  return { ...actual, logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
});
// QNBS-v3: getStaticTranslation hits the network (fetch) — never call real network in tests.
vi.mock('../../../../services/i18n/staticTranslate', () => ({
  getStaticTranslation: (key: string) =>
    Promise.resolve(key === 'export.loglineLabel' ? 'Logline' : 'Manuscript'),
}));

import { appStoreRef } from '../../../../app/storeRef';
import {
  compressData,
  compressJsonText,
  decompressData,
  decompressJsonText,
  ProjectFileLockedError,
  StaleProjectWriterError,
} from '../../../../services/fs/fsCore';
import {
  FsProjectStore,
  ProjectCanonicalWritebackError,
} from '../../../../services/fs/projectFsStore';
import { logger } from '../../../../services/logger';

// QNBS-v3: shared Binder fixture keeps schema-complete asset nodes consistent across filesystem cleanup and routing tests.
const legacyBinderNode = (binderAssetId: string) => ({
  id: `binder-${binderAssetId}`,
  parentId: null,
  type: 'pdf' as const,
  title: `Legacy ${binderAssetId}`,
  sortIndex: 0,
  binderAssetId,
});

interface FakeFs {
  apis: TauriApis;
  text: Map<string, string>;
  bin: Map<string, Uint8Array>;
}

function makeFakeFs(): FakeFs {
  const text = new Map<string, string>();
  const bin = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/app']);
  const under = (p: string): string[] => {
    const names = new Set<string>();
    for (const k of [...text.keys(), ...bin.keys()]) {
      if (k.startsWith(`${p}/`)) names.add(k.slice(p.length + 1).split('/')[0] as string);
    }
    return [...names];
  };
  const apis: TauriApis = {
    appDataDir: () => Promise.resolve('/app'),
    join: (...parts: string[]) => Promise.resolve(parts.join('/')),
    exists: (p: string) =>
      Promise.resolve(text.has(p) || bin.has(p) || dirs.has(p) || under(p).length > 0),
    mkdir: (p: string, options?: { recursive?: boolean }) => {
      if (dirs.has(p) && !options?.recursive) {
        return Promise.reject(new Error(`EEXIST ${p}`));
      }
      dirs.add(p);
      return Promise.resolve();
    },
    writeTextFile: (p: string, c: string, opts?: { createNew?: boolean }) => {
      if (opts?.createNew && text.has(p)) {
        return Promise.reject(new Error(`EEXIST ${p}`));
      }
      text.set(p, c);
      return Promise.resolve();
    },
    readTextFile: (p: string) => {
      if (!text.has(p)) return Promise.reject(new Error(`ENOENT ${p}`));
      return Promise.resolve(text.get(p) as string);
    },
    writeFile: (p: string, d: Uint8Array) => {
      bin.set(p, d);
      return Promise.resolve();
    },
    readFile: (p: string) => {
      if (!bin.has(p)) return Promise.reject(new Error(`ENOENT ${p}`));
      return Promise.resolve(bin.get(p) as Uint8Array<ArrayBuffer>);
    },
    remove: (p: string) => {
      text.delete(p);
      bin.delete(p);
      dirs.delete(p);
      for (const k of [...text.keys()]) if (k.startsWith(`${p}/`)) text.delete(k);
      for (const k of [...bin.keys()]) if (k.startsWith(`${p}/`)) bin.delete(k);
      return Promise.resolve();
    },
    // QNBS-v3: recursive fake moves preserve every project asset so quarantine tests prove full-directory recovery.
    rename: (from: string, to: string) => {
      const fromEntries = [...text.keys(), ...bin.keys(), ...dirs].filter(
        (path, index, paths) =>
          paths.indexOf(path) === index && (path === from || path.startsWith(`${from}/`)),
      );
      if (fromEntries.length === 0) return Promise.reject(new Error(`ENOENT ${from}`));
      const targetDirectoryExists =
        dirs.has(to) ||
        [...text.keys(), ...bin.keys(), ...dirs].some((path) => path.startsWith(`${to}/`));
      if (targetDirectoryExists) return Promise.reject(new Error(`EEXIST ${to}`));
      text.delete(to);
      bin.delete(to);
      for (const path of fromEntries) {
        const target = `${to}${path.slice(from.length)}`;
        const textValue = text.get(path);
        const binaryValue = bin.get(path);
        if (textValue !== undefined) {
          text.delete(path);
          text.set(target, textValue);
        }
        if (binaryValue !== undefined) {
          bin.delete(path);
          bin.set(target, binaryValue);
        }
        if (dirs.delete(path)) dirs.add(target);
      }
      return Promise.resolve();
    },
    readDir: (p: string) => Promise.resolve(under(p).map((name) => ({ name, isDirectory: false }))),
    open: () => Promise.resolve(null),
    save: () => Promise.resolve(null),
  };
  return { apis, text, bin };
}

let store: FsProjectStore;
let fake: FakeFs;

beforeEach(() => {
  fake = makeFakeFs();
  fsHolder.current = fake.apis;
  store = new FsProjectStore();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('FsProjectStore — projects', () => {
  const project = {
    id: 'p1',
    schemaVersion: 1,
    title: 'My Novel',
    logline: 'A tale',
    manuscript: [{ id: 's1', title: 'Ch1', content: 'hello world foo' }],
    characters: [],
    worlds: [],
    outline: [],
  };

  it('round-trips save/load and lists/deletes a project', async () => {
    await store.saveProject(project as never);
    const loaded = await store.loadProject('p1');
    expect(loaded?.title).toBe('My Novel');

    expect(await store.listProjects()).toContain('p1');

    await store.deleteProject('p1');
    expect(await store.loadProject('p1')).toBeNull();
    expect(await store.listProjects()).not.toContain('p1');
  });

  // QNBS-v3: fresh filesystem writes carry an explicit current marker so this build does not reclassify its own output as legacy.
  it('stamps a current schema version on newly created projects', async () => {
    const { schemaVersion: _schemaVersion, ...unversionedProject } = project;

    await store.saveProject(unversionedProject as never);

    const persisted = decompressData<Record<string, unknown>>(
      fake.text.get('/app/projects/p1/project.json') as string,
    );
    expect(persisted['schemaVersion']).toBe(1);
  });

  // QNBS-v3 (#553): the Tauri filesystem writer must preserve opaque project data and exact raw numeric tokens when editing a CURRENT carrier.
  it('updates a current filesystem project through raw-carrier writeback', async () => {
    const source =
      '{"schemaVersion":1,"id":"p1","title":"Original","logline":"A tale","manuscript":[],"characters":[{"id":"c1","name":"Ada","opaqueNumber":9007199254740993,"opaque":{"keep":true}}],"worlds":[],"opaqueTop":{"numeric":9007199254740993}}';
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/p1/project.json', source);

    await store.saveProject({
      ...project,
      title: 'Updated',
      characters: [{ id: 'c1', name: 'Ada updated' }],
    } as never);

    const savedRaw = decompressJsonText(fake.text.get('/app/projects/p1/project.json') as string);
    expect(JSON.parse(savedRaw)).toMatchObject({ title: 'Updated' });
    expect(savedRaw).toContain('"opaqueNumber":9007199254740993');
    expect(savedRaw).toContain('"opaque":{"keep":true}');
    expect(savedRaw).toContain('"opaqueTop":{"numeric":9007199254740993}');
  });

  it('removes an owned optional field from the current filesystem raw carrier when the snapshot omits it', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const source = JSON.stringify({
      ...project,
      aiPreset: { model: 'legacy-model' },
    });
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, source);

    await store.saveProject(project as never);

    expect(decompressJsonText(fake.text.get(sourcePath) as string)).not.toContain('"aiPreset"');
  });

  it('refuses an external source generation change before atomic filesystem replacement', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const concurrentRaw = JSON.stringify({
      ...project,
      title: 'Concurrent writer',
    });
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, JSON.stringify(project));
    const originalWriteTextFile = fake.apis.writeTextFile;
    fake.apis.writeTextFile = (path: string, content: string, opts?: { createNew?: boolean }) => {
      if (path.startsWith(`${sourcePath}.tmp-`)) {
        fake.text.set(sourcePath, compressJsonText(concurrentRaw));
      }
      return originalWriteTextFile(path, content, opts);
    };

    await expect(
      store.saveProject({ ...project, title: 'Local writer' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
      projectId: 'p1',
      detail: expect.stringContaining('source generation changed before atomic replacement'),
    });
    expect(decompressJsonText(fake.text.get(sourcePath) as string)).toBe(concurrentRaw);
    expect([...fake.text.keys()].some((path) => path.startsWith(`${sourcePath}.tmp-`))).toBe(false);
  });

  // QNBS-v3 (#553): the generation re-check above narrows the TOCTOU gap but does not close it — these prove the cross-process lock actually gates persistExistingCanonicalProject.
  it('acquires and releases a cross-process lock around an existing-project save', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const lockPath = '/app/project-locks/p1.lock';
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, JSON.stringify(project));

    await store.saveProject({ ...project, title: 'Locked and saved' } as never);

    // QNBS-v3 (#553): the lock lives outside projects/<id>/ — see the dedicated quarantine/delete test below for why.
    expect(fake.text.has(`${sourcePath}.lock`)).toBe(false);
    expect(fake.text.has(lockPath)).toBe(false);
    expect(JSON.parse(decompressJsonText(fake.text.get(sourcePath) as string))).toMatchObject({
      title: 'Locked and saved',
    });
  });

  it('refuses an existing-project save while another writer holds the lock', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const lockPath = '/app/project-locks/p1.lock';
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, JSON.stringify(project));
    await fake.apis.mkdir('/app/project-locks', { recursive: true });
    await fake.apis.writeTextFile(lockPath, 'locked');

    // QNBS-v3 (#553): ProjectFileLockedError now propagates as itself (unwrapped) so a caller — e.g. the autosave listener — can give a truthful, distinct "another writer holds the lock" message instead of the same generic writeback-refusal message as every other cause.
    await expect(
      store.saveProject({ ...project, title: 'Blocked writer' } as never),
    ).rejects.toBeInstanceOf(ProjectFileLockedError);
    expect(decompressJsonText(fake.text.get(sourcePath) as string)).toBe(JSON.stringify(project));
    // QNBS-v3 (#553): a held lock must never be removed by a caller that didn't create it — no reclaim exists.
    expect(fake.text.has(lockPath)).toBe(true);
  });

  // QNBS-v3 (#553, Thread 0): locking only the existing-project branch left this exact race — two processes could both observe an absent project.json and independently create it, the later one silently overwriting the earlier.
  it('refuses a first-time save while another writer holds the lock for the same not-yet-created project', async () => {
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.mkdir('/app/project-locks', { recursive: true });
    await fake.apis.writeTextFile('/app/project-locks/p1.lock', 'locked');

    await expect(store.saveProject(project as never)).rejects.toBeInstanceOf(
      ProjectFileLockedError,
    );
    expect(fake.text.has('/app/projects/p1/project.json')).toBe(false);
  });

  // QNBS-v3 (#553): quarantine and delete now take the project lock themselves, so neither can run under a concurrent writer; the lock, living outside projects/<id>/, is never moved or removed by the refused operation.
  it.each([
    ['quarantine', () => store.quarantineProject('p1'), 'ProjectQuarantineError'],
    ['delete', () => store.deleteProject('p1'), 'ProjectFileLockedError'],
  ])(
    'refuses a %s while another writer holds the project lock, leaving both intact',
    async (_label, act, errorName) => {
      const sourcePath = '/app/projects/p1/project.json';
      const lockPath = '/app/project-locks/p1.lock';
      await fake.apis.mkdir('/app/projects/p1', { recursive: true });
      await fake.apis.writeTextFile(sourcePath, JSON.stringify(project));
      await fake.apis.mkdir('/app/project-locks', { recursive: true });
      await fake.apis.writeTextFile(lockPath, 'locked');

      await expect(act()).rejects.toMatchObject({ name: errorName });

      expect(fake.text.has(sourcePath)).toBe(true);
      expect(fake.text.has(lockPath)).toBe(true);
    },
  );

  it('refuses non-current filesystem writeback without changing the stored source', async () => {
    const { schemaVersion: _schemaVersion, ...legacyProject } = project;
    const sourcePath = '/app/projects/p1/project.json';
    const original = compressData(legacyProject);
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, original);

    await expect(
      store.saveProject({ ...project, title: 'Updated' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
      projectId: 'p1',
      message:
        'Project save was refused to preserve the stored data. Reload the project and try again.',
      detail: expect.stringContaining('LEGACY_UNVERSIONED'),
    });
    expect(fake.text.get(sourcePath)).toBe(original);
  });

  it('does not create an auto-snapshot when canonical filesystem save is refused', async () => {
    const { schemaVersion: _schemaVersion, ...legacyProject } = project;
    const sourcePath = '/app/projects/p1/project.json';
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, compressData(legacyProject));
    const snapshotSpy = vi.spyOn(store, 'saveSnapshot');

    await expect(
      store.saveProject({ ...project, title: 'Updated' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
    });
    await Promise.resolve();

    expect(snapshotSpy).not.toHaveBeenCalled();
    expect([...fake.text.keys()].some((path) => path.startsWith('/app/snapshots/'))).toBe(false);
  });

  it('fails closed with a stable public error when the current source cannot be read', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const original = compressData(project);
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, original);
    fake.apis.readTextFile = () => Promise.reject(new Error('disk unavailable'));

    await expect(
      store.saveProject({ ...project, title: 'Updated' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
      projectId: 'p1',
      message:
        'Project save was refused to preserve the stored data. Reload the project and try again.',
      detail: expect.stringContaining('disk unavailable'),
    });
    expect(fake.text.get(sourcePath)).toBe(original);
  });

  it('fails closed with a stable public error when source existence cannot be inspected', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const original = compressData(project);
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, original);
    const originalExists = fake.apis.exists;
    fake.apis.exists = (path: string) =>
      path === sourcePath
        ? Promise.reject(new Error('source existence unavailable'))
        : originalExists(path);

    await expect(
      store.saveProject({ ...project, title: 'Updated' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
      projectId: 'p1',
      message:
        'Project save was refused to preserve the stored data. Reload the project and try again.',
      detail: expect.stringContaining('source existence unavailable'),
    });
    expect(fake.text.get(sourcePath)).toBe(original);
  });

  it('fails closed with a stable public error when atomic replacement fails', async () => {
    const sourcePath = '/app/projects/p1/project.json';
    const original = compressData(project);
    await fake.apis.mkdir('/app/projects/p1', { recursive: true });
    await fake.apis.writeTextFile(sourcePath, original);
    const originalRename = fake.apis.rename;
    fake.apis.rename = (from: string, to: string) =>
      to === sourcePath
        ? Promise.reject(new Error('atomic replacement unavailable'))
        : originalRename(from, to);

    await expect(
      store.saveProject({ ...project, title: 'Updated' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
      projectId: 'p1',
      message:
        'Project save was refused to preserve the stored data. Reload the project and try again.',
      detail: expect.stringContaining('atomic replacement unavailable'),
    });
    expect(fake.text.get(sourcePath)).toBe(original);
  });

  it('returns null for a missing project and [] when no projects dir', async () => {
    expect(await store.loadProject('nope')).toBeNull();
    expect(await store.listProjects()).toEqual([]);
  });

  // QNBS-v3: the regression protects manuscripts and assets from partial or destructive quarantine.
  it('quarantines a complete project directory without deleting or relisting it', async () => {
    await store.saveProject(project as never);
    const original = fake.text.get('/app/projects/p1/project.json');

    const result = await store.quarantineProject('p1');

    expect(result.projectId).toBe('p1');
    expect(result.path).toMatch(/^\/app\/quarantined-projects\/p1-corrupt-/);
    expect(fake.text.get(`${result.path}/project.json`)).toBe(original);
    expect(fake.text.has('/app/projects/p1/project.json')).toBe(false);
    expect(await store.listProjects()).not.toContain('p1');
    await expect(store.loadProject('p1')).resolves.toBeNull();
  });

  // QNBS-v3: prove a claimed quarantine target cannot turn preserve-first recovery into data loss.
  it('tries the next quarantine name when a concurrent rename claims the checked target', async () => {
    await store.saveProject(project as never);
    const originalMkdir = fake.apis.mkdir;
    let firstTarget: string | undefined;
    let racePending = true;
    fake.apis.mkdir = (path: string, options?: { recursive?: boolean }) => {
      if (racePending && path.startsWith('/app/quarantined-projects/p1-corrupt-')) {
        racePending = false;
        firstTarget = path;
        return originalMkdir(path, options).then(() => Promise.reject(new Error(`EEXIST ${path}`)));
      }
      return originalMkdir(path, options);
    };

    const result = await store.quarantineProject('p1');

    expect(firstTarget).toBeDefined();
    expect(result.path).toBe(`${firstTarget}-1/p1`);
    expect(fake.text.get(`${result.path}/project.json`)).toBeDefined();
    expect(fake.text.has('/app/projects/p1/project.json')).toBe(false);
  });

  // QNBS-v3: report an unidentifiable concurrent move without claiming a path that was not observed.
  it('reports source-missing when another recovery moved the source elsewhere', async () => {
    await store.saveProject(project as never);
    const original = fake.text.get('/app/projects/p1/project.json');
    const originalRename = fake.apis.rename;
    fake.apis.rename = async (from: string) => {
      const concurrentPath = '/app/quarantined-projects/p1-corrupt-concurrent';
      await originalRename(from, concurrentPath);
      throw new Error(`ENOENT ${from}`);
    };

    await expect(store.quarantineProject('p1')).rejects.toMatchObject({
      name: 'ProjectQuarantineError',
      reason: 'source-missing',
    });
    expect(await store.listProjects()).not.toContain('p1');
    expect(fake.text.get('/app/quarantined-projects/p1-corrupt-concurrent/project.json')).toBe(
      original,
    );
  });

  // QNBS-v3: a vanished source without a verified destination is not evidence of preservation.
  it('reports source-missing when the source disappears without a quarantine copy', async () => {
    await store.saveProject(project as never);
    fake.apis.rename = async (from: string) => {
      await fake.apis.remove(from);
      throw new Error(`ENOENT ${from}`);
    };

    await expect(store.quarantineProject('p1')).rejects.toMatchObject({
      name: 'ProjectQuarantineError',
      reason: 'source-missing',
      message:
        'The project source is no longer present, but its preservation location could not be confirmed.',
    });
  });

  // QNBS-v3: quarantine retains verified legacy routing without moving ambiguous fallback data into the recovery copy.
  it('persists verified legacy routing beside a quarantined project', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    await store.loadProject('item');
    const result = await store.quarantineProject('item');
    const quarantineContainer = result.path.slice(0, result.path.lastIndexOf('/'));

    expect(fake.text.get(`${quarantineContainer}/legacy-auxiliary.json`)).toBe(
      JSON.stringify({
        projectId: 'item',
        legacyProjectId: 'project',
        codex: true,
        binderAssetIds: [],
      }),
    );
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(true);
    expect(fake.text.has(`${result.path}/project.json`)).toBe(true);
    expect(await store.getStoryCodex('item')).toBeNull();
  });

  it('does not map an unusable project ID to an arbitrary quarantine directory', async () => {
    await expect(store.saveProject({ ...project, id: '***' } as never)).rejects.toThrow(
      'Cannot save a project with an unusable project ID.',
    );

    await expect(store.loadProject('***')).resolves.toBeNull();
    await expect(store.deleteProject('***')).resolves.toBeUndefined();
    await expect(store.quarantineProject('***')).rejects.toMatchObject({
      name: 'ProjectQuarantineError',
      reason: 'not-found',
    });
    expect([...fake.text.keys()].some((path) => path.startsWith('/app/projects/'))).toBe(false);
  });

  it('migrates a legacy invalid ID to its existing directory identity before save', async () => {
    const legacyProject = { ...project, id: '***' };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));

    const loaded = await store.loadProject('item');

    expect((loaded as unknown as Record<string, unknown>)['id']).toBe('item');
    await expect(store.saveProject(loaded as never)).resolves.toBeUndefined();
    expect(fake.text.has('/app/projects/item/project.json')).toBe(true);
    expect(await store.loadProject('item')).toEqual(expect.objectContaining({ title: 'My Novel' }));
  });

  // QNBS-v3: conflicting embedded identity is kept read-only under the canonical source directory.
  it('fences legacy writeback by both directory and embedded project identity', async () => {
    const legacyProject = {
      id: 'embedded-id',
      title: 'Legacy Novel',
      logline: 'A legacy tale',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/directory-id', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/directory-id/project.json',
      compressData(legacyProject),
    );

    const loaded = await store.loadProject('directory-id');

    expect((loaded as unknown as Record<string, unknown>)['id']).toBe('directory-id');
    await expect(
      store.saveProject({ ...loaded, title: 'Edited legacy novel' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectWritebackError',
      projectId: 'directory-id',
    });
    expect(fake.text.has('/app/projects/embedded-id/project.json')).toBe(false);
  });

  // QNBS-v3: a valid current source can reclaim its own identity without inheriting a legacy alias fence.
  it('does not let a conflicting legacy alias fence a valid current project', async () => {
    await store.saveProject({ ...project, id: 'embedded-id' } as never);
    await fake.apis.mkdir('/app/projects/directory-id', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/directory-id/project.json',
      compressData({
        id: 'embedded-id',
        title: 'Legacy Novel',
        logline: 'A legacy tale',
        manuscript: [],
        characters: [],
        worlds: [],
      }),
    );

    await store.loadProject('directory-id');
    await expect(
      store.saveProject({ ...project, id: 'embedded-id', title: 'Current Novel' } as never),
    ).resolves.toBeUndefined();
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/embedded-id/project.json') as string,
      )['title'],
    ).toBe('Current Novel');
  });

  // QNBS-v3: snapshot restore cannot reintroduce mutable state for a project whose source lacks write authority.
  it('refuses snapshot restore for a fenced legacy project', async () => {
    const legacyProject = {
      title: 'Legacy Novel',
      logline: 'A legacy tale',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/legacy-snapshot', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/legacy-snapshot/project.json',
      compressData(legacyProject),
    );
    const loaded = await store.loadProject('legacy-snapshot');
    const snapshotId = await store.saveSnapshot('legacy', loaded);

    await expect(store.restoreSnapshot(snapshotId, loaded as never)).rejects.toMatchObject({
      name: 'ProjectSnapshotRestoreError',
      reason: 'target-unavailable',
    });
  });

  // QNBS-v3: absence clears the whole directory-owned fence so a later replacement can be saved safely.
  it('clears stale legacy writeback fences after the source disappears', async () => {
    const legacyProject = {
      id: 'replacement-id',
      title: 'Legacy Novel',
      logline: 'A legacy tale',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/old-directory', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/old-directory/project.json',
      compressData(legacyProject),
    );
    const loaded = await store.loadProject('old-directory');
    await expect(store.saveProject(loaded as never)).rejects.toMatchObject({
      name: 'ProjectWritebackError',
    });

    await fake.apis.remove('/app/projects/old-directory', { recursive: true });
    await expect(store.loadProject('old-directory')).resolves.toBeNull();
    await expect(
      store.saveProject({ ...project, id: 'replacement-id' } as never),
    ).resolves.toBeUndefined();
  });

  // QNBS-v3: auxiliary project files cannot mutate while the owning legacy source is fenced.
  it('fences project-owned auxiliary asset writes and deletes for legacy projects', async () => {
    const asset = new Uint8Array([1, 2, 3]).buffer;
    await store.saveBinderAsset('legacy-assets', 'asset-1', asset, {
      mimeType: 'application/pdf',
      originalFileName: 'legacy.pdf',
      byteSize: 3,
    });
    await store.saveStoryCodex({
      projectId: 'legacy-assets',
      extractedAt: '2026-01-01T00:00:00.000Z',
      entities: [],
      summary: 'legacy',
    });
    await store.saveRagVectors('legacy-assets', [{ id: 'vector-1' }]);
    await fake.apis.mkdir('/app/projects/legacy-assets', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/legacy-assets/project.json',
      compressData({
        title: 'Legacy Assets',
        logline: 'L',
        manuscript: [],
        characters: [],
        worlds: [],
      }),
    );
    await store.loadProject('legacy-assets');

    await expect(
      store.saveBinderAsset('legacy-assets', 'asset-2', asset, {
        mimeType: 'application/pdf',
        originalFileName: 'new.pdf',
        byteSize: 3,
      }),
    ).rejects.toMatchObject({ name: 'ProjectWritebackError' });
    await expect(store.deleteBinderAsset('legacy-assets', 'asset-1')).rejects.toMatchObject({
      name: 'ProjectWritebackError',
    });
    await expect(store.deleteStoryCodex('legacy-assets')).rejects.toMatchObject({
      name: 'ProjectWritebackError',
    });
    await expect(store.saveRagVectors('legacy-assets', [{ id: 'vector-2' }])).rejects.toMatchObject(
      {
        name: 'ProjectWritebackError',
      },
    );
    await expect(store.deleteRagVectors('legacy-assets')).rejects.toMatchObject({
      name: 'ProjectWritebackError',
    });
    await expect(store.getBinderAsset('legacy-assets', 'asset-1')).resolves.not.toBeNull();
    await expect(store.getStoryCodex('legacy-assets')).resolves.not.toBeNull();
    await expect(store.getRagVectors('legacy-assets')).resolves.toEqual([{ id: 'vector-1' }]);
  });

  // QNBS-v3: ID-less legacy callers can only address the retained source directory, never an ambiguous fallback route.
  it('fails closed for ID-less legacy Binder, Codex, and RAG writes', async () => {
    const asset = new Uint8Array([1, 2, 3]).buffer;
    const legacyProject = {
      title: 'ID-less Legacy',
      logline: 'L',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/idless-legacy', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/idless-legacy/project.json',
      JSON.stringify(legacyProject),
    );
    await fake.apis.mkdir('/app/projects/browser-project/binder', { recursive: true });
    await fake.apis.writeFile(
      '/app/projects/browser-project/binder/legacy.bin',
      new Uint8Array([9]),
    );
    await fake.apis.mkdir('/app/projects/default/codex', { recursive: true });
    const originalCodex = { projectId: 'default', entries: [{ name: 'legacy' }] };
    await fake.apis.writeTextFile(
      '/app/projects/default/codex/codex.snap',
      compressData(originalCodex),
    );
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    const originalVectors = [{ id: 'legacy-vector' }];
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/vectors.snap',
      compressData(originalVectors),
    );

    await store.loadProject('idless-legacy');
    await expect(
      store.saveBinderAsset('idless-legacy', 'new', asset, {
        mimeType: 'application/pdf',
        originalFileName: 'new.pdf',
        byteSize: 3,
      }),
    ).rejects.toMatchObject({ name: 'ProjectWritebackError' });
    await expect(
      store.saveStoryCodex({ projectId: 'idless-legacy', entries: [{ name: 'new' }] } as never),
    ).rejects.toMatchObject({ name: 'ProjectWritebackError' });
    await expect(
      store.saveRagVectors('idless-legacy', [{ id: 'new-vector' }]),
    ).rejects.toMatchObject({ name: 'ProjectWritebackError' });
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/default/codex/codex.snap') as string,
      ),
    ).toEqual(originalCodex);
    expect(
      decompressData<unknown[]>(
        fake.text.get('/app/projects/project/codex/vectors.snap') as string,
      ),
    ).toEqual(originalVectors);
    expect(fake.bin.has('/app/projects/browser-project/binder/new.bin')).toBe(false);
  });

  // QNBS-v3: background ID-less inspection cannot install a global fallback fence over a valid CURRENT source.
  it('keeps CURRENT fallback writes authoritative after ID-less legacy inspection', async () => {
    await store.saveProject({ ...project, id: 'project' } as never);
    const legacyProject = {
      title: 'ID-less Legacy',
      logline: 'L',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/idless-legacy', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/idless-legacy/project.json',
      JSON.stringify(legacyProject),
    );

    await store.loadProject('idless-legacy');
    await store.loadProject('project');

    await expect(
      store.saveBinderAsset('project', 'ambiguous', new Uint8Array([1]).buffer, {
        mimeType: 'application/octet-stream',
        originalFileName: 'ambiguous.bin',
        byteSize: 1,
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.saveStoryCodex({ projectId: 'project', entries: [{ name: 'ambiguous' }] } as never),
    ).resolves.toBeUndefined();
    await expect(store.saveRagVectors('project', [{ id: 'ambiguous' }])).resolves.toBeUndefined();
    expect(fake.bin.has('/app/projects/project/binder/ambiguous.bin')).toBe(true);
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(true);
    expect(fake.text.has('/app/projects/project/codex/vectors.snap')).toBe(true);
  });

  // QNBS-v3: readable legacy bytes remain available to inspection but cannot cross the editable bootstrap boundary.
  it('refuses ID-less legacy admission for the editable application state without rewriting the source', async () => {
    const legacyProject = {
      title: 'ID-less Legacy',
      logline: 'L',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    const source = '/app/projects/idless-legacy/project.json';
    await fake.apis.mkdir('/app/projects/idless-legacy', { recursive: true });
    await fake.apis.writeTextFile(source, JSON.stringify(legacyProject));
    const before = fake.text.get(source);

    await expect(store.loadProjectForEditing('idless-legacy')).rejects.toMatchObject({
      name: 'ProjectLoadError',
      reason: 'unsupported-version',
      classification: 'LEGACY_UNVERSIONED',
      projectId: 'idless-legacy',
    });
    expect(fake.text.get(source)).toBe(before);
  });

  // QNBS-v3: authority is checked after queued work completes so a load cannot race a later mutation.
  it('rechecks legacy authority after a queued admission change', async () => {
    const legacyProject = {
      title: 'Racing Legacy',
      logline: 'L',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/racing-legacy', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/racing-legacy/project.json',
      JSON.stringify(legacyProject),
    );

    const originalWriteTextFile = fake.apis.writeTextFile;
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    fake.apis.writeTextFile = (path: string, content: string) => {
      if (path.startsWith('/app/projects/queue-holder/codex/codex.snap.tmp-')) {
        writeStarted();
        return new Promise<void>((resolve, reject) => {
          releaseWrite = () => originalWriteTextFile(path, content).then(resolve, reject);
        });
      }
      return originalWriteTextFile(path, content);
    };

    const holder = store.saveStoryCodex({ projectId: 'queue-holder', entries: [] } as never);
    await writeStartedPromise;
    const load = store.loadProject('racing-legacy');
    const queuedWrite = store.saveStoryCodex({ projectId: 'racing-legacy', entries: [] } as never);

    releaseWrite();
    await holder;
    await load;
    await expect(queuedWrite).rejects.toMatchObject({ name: 'ProjectWritebackError' });
    expect(fake.text.has('/app/projects/racing-legacy/codex/codex.snap')).toBe(false);
  });

  // QNBS-v3: auxiliary fence checks use the writers' sanitized identity and fallback so invalid IDs cannot bypass legacy writeback policy.
  it('normalizes legacy auxiliary fence identities before mutation', async () => {
    const asset = new Uint8Array([1, 2, 3]).buffer;
    await fake.apis.mkdir('/app/projects/foo-bar', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/foo-bar/project.json',
      compressData({
        id: 'foo/bar',
        title: 'Legacy Path ID',
        logline: 'L',
        manuscript: [],
        characters: [],
        worlds: [],
      }),
    );
    await store.loadProject('foo-bar');

    await expect(
      store.saveBinderAsset('foo/bar', 'asset-1', asset, {
        mimeType: 'application/pdf',
        originalFileName: 'new.pdf',
        byteSize: 3,
      }),
    ).rejects.toMatchObject({ name: 'ProjectWritebackError' });

    await fake.apis.mkdir('/app/projects/project', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/project.json',
      compressData({
        id: '***',
        title: 'Legacy Fallback ID',
        logline: 'L',
        manuscript: [],
        characters: [],
        worlds: [],
      }),
    );
    await store.loadProject('project');

    await expect(store.saveRagVectors('***', [])).rejects.toMatchObject({
      name: 'ProjectWritebackError',
    });
  });

  // QNBS-v3: verified Codex and Binder evidence remains addressable while provenance-free vectors stay unassigned.
  it('keeps verified legacy Binder and Codex data addressable without assigning ambiguous RAG data', async () => {
    const legacyProject = {
      ...project,
      id: '***',
      binderNodes: [legacyBinderNode('legacy-asset')],
    };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    const legacyVectors = [{ id: 'legacy-vector' }];

    await store.saveStoryCodex(legacyCodex as never);
    await store.saveRagVectors('***', legacyVectors);
    await store.saveBinderAsset('***', 'legacy-asset', new Uint8Array([1, 2]).buffer, {
      mimeType: 'application/octet-stream',
      originalFileName: 'legacy.bin',
      byteSize: 2,
    });
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));

    const loaded = await store.loadProject('item');

    expect((loaded as unknown as Record<string, unknown>)['id']).toBe('item');
    expect(await store.getStoryCodex('item')).toEqual(legacyCodex);
    expect(await store.getRagVectors('item')).toEqual([]);
    expect(await store.getRagVectors('project')).toEqual(legacyVectors);
    expect(await store.listBinderAssetIds('item')).toContain('legacy-asset');
    expect(await store.getBinderAsset('item', 'legacy-asset')).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({ originalFileName: 'legacy.bin' }),
      }),
    );

    await fake.apis.writeFile('/app/projects/project/binder/unregistered.bin', new Uint8Array([9]));
    await fake.apis.writeTextFile(
      '/app/projects/project/binder/unregistered.meta.json',
      JSON.stringify({
        mimeType: 'application/octet-stream',
        originalFileName: 'unregistered.bin',
        byteSize: 1,
      }),
    );
    expect(await store.listBinderAssetIds('item')).not.toContain('unregistered');
    await expect(store.getBinderAsset('item', 'unregistered')).resolves.toBeNull();
    await store.deleteAllBinderAssetsForProject('item');
    expect(fake.bin.has('/app/projects/project/binder/unregistered.bin')).toBe(true);
    expect(fake.text.has('/app/projects/project/binder/unregistered.meta.json')).toBe(true);

    await store.saveProject(loaded as never);
    expect(fake.text.has('/app/projects/item/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/project/project.json')).toBe(false);

    await store.deleteProject('item');
    expect(fake.text.has('/app/projects/item/project.json')).toBe(false);
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(false);
    expect(fake.text.has('/app/projects/project/codex/vectors.snap')).toBe(true);
    expect(fake.bin.has('/app/projects/project/binder/legacy-asset.bin')).toBe(false);
  });

  // QNBS-v3: complete route-using mutations serialize so a legitimate fallback claimant cannot change ownership mid-operation.
  it('keeps a legacy Codex write on one route while a fallback claimant waits', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );
    await store.loadProject('item');

    const originalWriteTextFile = fake.apis.writeTextFile;
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    fake.apis.writeTextFile = (path: string, content: string) => {
      if (path.startsWith('/app/projects/project/codex/codex.snap.tmp-')) {
        writeStarted();
        return new Promise<void>((resolve, reject) => {
          releaseWrite = () => {
            originalWriteTextFile(path, content).then(resolve, reject);
          };
        });
      }
      return originalWriteTextFile(path, content);
    };

    const legacyWrite = store.saveStoryCodex({
      projectId: 'item',
      entries: [{ name: 'updated' }],
    } as never);
    await writeStartedPromise;

    let claimantFinished = false;
    const claimant = store
      .saveProject({ ...project, id: 'project', title: 'Legitimate Project' } as never)
      .then(() => {
        claimantFinished = true;
      });
    await Promise.resolve();
    expect(claimantFinished).toBe(false);

    releaseWrite();
    await legacyWrite;
    await claimant;

    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/project/codex/codex.snap') as string,
      ),
    ).toEqual({ projectId: 'item', entries: [{ name: 'updated' }] });
    expect(fake.text.has('/app/projects/project/project.json')).toBe(true);
  });

  // QNBS-v3: deletion cannot report success after route ownership changes during auxiliary cleanup.
  it('serializes legacy deletion before a legitimate fallback claimant can save', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );
    await store.loadProject('item');

    const originalRemove = fake.apis.remove;
    let releaseRemove!: () => void;
    let removeStarted!: () => void;
    const removeStartedPromise = new Promise<void>((resolve) => {
      removeStarted = resolve;
    });
    fake.apis.remove = (path: string, options?: { recursive?: boolean }) => {
      if (path === '/app/projects/project/codex/codex.snap') {
        removeStarted();
        return new Promise<void>((resolve, reject) => {
          releaseRemove = () => {
            originalRemove(path, options).then(resolve, reject);
          };
        });
      }
      return originalRemove(path, options);
    };

    const deletion = store.deleteProject('item');
    await removeStartedPromise;

    let claimantFinished = false;
    const claimant = store
      .saveProject({ ...project, id: 'project', title: 'Legitimate Project' } as never)
      .then(() => {
        claimantFinished = true;
      });
    await Promise.resolve();
    expect(claimantFinished).toBe(false);

    releaseRemove();
    await deletion;
    await claimant;

    expect(fake.text.has('/app/projects/item/project.json')).toBe(false);
    expect(fake.text.has('/app/projects/project/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(false);
  });

  // QNBS-v3: a normalized directory identity remains valid evidence while a legacy main file still carries the raw ID.
  it('accepts the normalized project identity in a legacy Codex snapshot', async () => {
    const legacyProject = { ...project, id: '***' };
    const migratedCodex = { projectId: 'item', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(migratedCodex),
    );

    await expect(store.loadProject('item')).resolves.toEqual(
      expect.objectContaining({ id: 'item' }),
    );
    await expect(store.getStoryCodex('item')).resolves.toEqual(migratedCodex);
  });

  // QNBS-v3: partial Binder enumeration keeps healthy current assets visible when legacy inspection is temporarily unavailable.
  it('retains current Binder IDs when the legacy directory cannot be listed', async () => {
    const legacyProject = {
      ...project,
      id: '***',
      binderNodes: [legacyBinderNode('legacy-asset')],
    };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/binder', { recursive: true });
    await fake.apis.writeFile('/app/projects/project/binder/legacy-asset.bin', new Uint8Array([1]));
    await fake.apis.writeTextFile(
      '/app/projects/project/binder/legacy-asset.meta.json',
      JSON.stringify({
        mimeType: 'application/octet-stream',
        originalFileName: 'legacy.bin',
        byteSize: 1,
      }),
    );
    await store.loadProject('item');
    await store.saveBinderAsset('item', 'current-asset', new Uint8Array([2]).buffer, {
      mimeType: 'application/octet-stream',
      originalFileName: 'current.bin',
      byteSize: 1,
    });

    const originalReadDir = fake.apis.readDir;
    fake.apis.readDir = async (path: string) => {
      if (path === '/app/projects/project/binder') {
        throw new Error('EAGAIN: legacy Binder directory temporarily unavailable');
      }
      return originalReadDir(path);
    };

    await expect(store.listBinderAssetIds('item')).resolves.toEqual(['current-asset']);
  });

  // QNBS-v3: persisted legacy provenance keeps coupled filesystem data visible after a desktop restart.
  it('persists verified legacy auxiliary routing across normalized saves and reloads', async () => {
    const legacyProject = {
      ...project,
      id: '***',
      binderNodes: [legacyBinderNode('legacy-asset')],
    };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/binder', { recursive: true });
    await fake.apis.writeFile(
      '/app/projects/project/binder/legacy-asset.bin',
      new Uint8Array([1, 2]),
    );
    await fake.apis.writeTextFile(
      '/app/projects/project/binder/legacy-asset.meta.json',
      JSON.stringify({
        mimeType: 'application/octet-stream',
        originalFileName: 'legacy.bin',
        byteSize: 2,
      }),
    );
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    const loaded = await store.loadProject('item');
    await store.saveProject(loaded as never);

    const restarted = new FsProjectStore();
    await expect(restarted.loadProject('item')).resolves.toEqual(
      expect.objectContaining({ id: 'item' }),
    );
    await expect(restarted.getStoryCodex('item')).resolves.toEqual(legacyCodex);
    await expect(restarted.getStoryCodex('item/')).resolves.toEqual(legacyCodex);
    await expect(restarted.getBinderAsset('item', 'legacy-asset')).resolves.toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({ originalFileName: 'legacy.bin' }),
      }),
    );
  });

  // QNBS-v3: persisted legacy routing must be revalidated so a later legitimate project cannot be captured by stale fallback metadata.
  it('does not restore persisted legacy routing after a legitimate project identity appears', async () => {
    const legacyProject = {
      ...project,
      id: '***',
      binderNodes: [legacyBinderNode('legacy-asset')],
    };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await store.saveStoryCodex(legacyCodex as never);
    await store.saveBinderAsset('***', 'legacy-asset', new Uint8Array([1]).buffer, {
      mimeType: 'application/octet-stream',
      originalFileName: 'legacy.bin',
      byteSize: 1,
    });
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));

    const loaded = await store.loadProject('item');
    await store.saveProject(loaded as never);

    const legitimateProject = { ...project, id: 'project', title: 'Legitimate Project' };
    const legitimateCodex = { projectId: 'project', entries: [{ name: 'legitimate' }] };
    const legitimateVectors = [{ id: 'legitimate-vector' }];
    await store.saveProject(legitimateProject as never);
    await expect(store.getStoryCodex('item')).resolves.toBeNull();
    await store.saveStoryCodex(legitimateCodex as never);
    await store.saveRagVectors('project', legitimateVectors);
    await store.saveBinderAsset('project', 'legitimate-asset', new Uint8Array([2]).buffer, {
      mimeType: 'application/octet-stream',
      originalFileName: 'legitimate.bin',
      byteSize: 1,
    });

    const restarted = new FsProjectStore();
    await expect(restarted.loadProject('item')).resolves.toEqual(
      expect.objectContaining({ id: 'item' }),
    );
    await expect(restarted.getStoryCodex('item')).resolves.toBeNull();
    await expect(restarted.listBinderAssetIds('item')).resolves.toEqual([]);
    await expect(restarted.getStoryCodex('project')).resolves.toEqual(legitimateCodex);
    await expect(restarted.getRagVectors('project')).resolves.toEqual(legitimateVectors);
    await expect(restarted.getBinderAsset('project', 'legitimate-asset')).resolves.not.toBeNull();
  });

  // QNBS-v3: a failed reload must retain the verified legacy route so transient reads do not hide auxiliary data.
  it('retains legacy routing when a later project reload fails', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await store.saveStoryCodex(legacyCodex as never);
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));

    await store.loadProject('item');
    const originalReadTextFile = fake.apis.readTextFile;
    fake.apis.readTextFile = async (path: string) => {
      if (path === '/app/projects/item/project.json') {
        throw new Error('EAGAIN: project temporarily unavailable');
      }
      return originalReadTextFile(path);
    };

    await expect(store.loadProject('item')).rejects.toMatchObject({
      name: 'ProjectLoadError',
      reason: 'io-error',
      projectId: 'item',
    });
    await expect(store.getStoryCodex('item')).resolves.toEqual(legacyCodex);
  });

  // QNBS-v3: incomplete legacy evidence fails closed instead of making an unverified normalization durable.
  it('aborts legacy migration when auxiliary ownership evidence cannot be read', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    const originalReadTextFile = fake.apis.readTextFile;
    fake.apis.readTextFile = async (path: string) => {
      if (path === '/app/projects/project/codex/codex.snap') {
        throw new Error('EAGAIN: codex temporarily unavailable');
      }
      return originalReadTextFile(path);
    };

    await expect(store.loadProject('item')).rejects.toMatchObject({
      name: 'ProjectLoadError',
      reason: 'io-error',
      projectId: 'item',
    });
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/item/project.json') as string,
      )['id'],
    ).toBe('***');

    fake.apis.readTextFile = originalReadTextFile;
    await expect(store.loadProject('item')).resolves.toEqual(
      expect.objectContaining({ id: 'item' }),
    );
    await expect(store.getStoryCodex('item')).resolves.toEqual(legacyCodex);
  });

  // QNBS-v3: incomplete save-time evidence must not make an unverified legacy identity durable.
  it('rejects a legacy save when auxiliary ownership evidence is incomplete', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    const originalReadTextFile = fake.apis.readTextFile;
    fake.apis.readTextFile = async (path: string) => {
      if (path === '/app/projects/project/codex/codex.snap') {
        throw new Error('EAGAIN: codex temporarily unavailable');
      }
      return originalReadTextFile(path);
    };

    await expect(store.saveProject(legacyProject as never)).rejects.toThrow(
      'Cannot safely save this legacy project until its auxiliary data can be verified.',
    );
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/item/project.json') as string,
      )['id'],
    ).toBe('***');
  });

  // QNBS-v3: indeterminate fallback ownership cannot clear a route that remains the only safe retry path.
  it('defers persisted legacy routing when the fallback collision probe is indeterminate', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    const loaded = await store.loadProject('item');
    await store.saveProject(loaded as never);

    const originalExists = fake.apis.exists;
    fake.apis.exists = async (path: string) => {
      if (path === '/app/projects/project/project.json') {
        throw new Error('EIO: fallback collision probe unavailable');
      }
      return originalExists(path);
    };

    await expect(store.loadProject('item')).rejects.toMatchObject({
      name: 'ProjectLoadError',
      reason: 'io-error',
      projectId: 'item',
    });
    await expect(store.getStoryCodex('item')).resolves.toEqual(legacyCodex);
  });

  // QNBS-v3: Binder filename suffixes make dot-shaped legacy asset IDs safe without weakening project path rules.
  it('retains dot-shaped legacy Binder asset IDs across persisted routing', async () => {
    const legacyProject = {
      ...project,
      id: '***',
      binderNodes: [legacyBinderNode('.'), legacyBinderNode('..')],
    };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/binder', { recursive: true });
    await fake.apis.writeFile('/app/projects/project/binder/..bin', new Uint8Array([1]));
    await fake.apis.writeTextFile(
      '/app/projects/project/binder/..meta.json',
      JSON.stringify({
        mimeType: 'application/octet-stream',
        originalFileName: 'dot.bin',
        byteSize: 1,
      }),
    );
    await fake.apis.writeFile('/app/projects/project/binder/...bin', new Uint8Array([2]));
    await fake.apis.writeTextFile(
      '/app/projects/project/binder/...meta.json',
      JSON.stringify({
        mimeType: 'application/octet-stream',
        originalFileName: 'dot-dot.bin',
        byteSize: 1,
      }),
    );

    const loaded = await store.loadProject('item');
    await store.saveProject(loaded as never);
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/item/project.json') as string,
      )['__worldscriptLegacyAuxiliary'],
    ).toEqual(
      expect.objectContaining({
        binderAssetIds: expect.arrayContaining(['.', '..']),
      }),
    );
    const restarted = new FsProjectStore();

    await expect(restarted.loadProject('item')).resolves.toEqual(
      expect.objectContaining({ id: 'item' }),
    );
    await expect(restarted.getBinderAsset('item', '.')).resolves.toEqual(
      expect.objectContaining({ meta: expect.objectContaining({ originalFileName: 'dot.bin' }) }),
    );
    await expect(restarted.getBinderAsset('item', '..')).resolves.toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({ originalFileName: 'dot-dot.bin' }),
      }),
    );
    await expect(restarted.listBinderAssetIds('item')).resolves.toEqual(
      expect.arrayContaining(['.', '..']),
    );
  });

  // QNBS-v3: legacy cleanup failures stay retryable so deletion cannot report success while routed data remains.
  it('retains legacy routing when auxiliary cleanup fails during deletion', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );
    await store.loadProject('item');

    const originalRemove = fake.apis.remove;
    fake.apis.remove = async (path: string, options?: { recursive?: boolean }) => {
      if (path === '/app/projects/project/codex/codex.snap') {
        throw new Error('EIO: legacy codex cleanup unavailable');
      }
      return originalRemove(path, options);
    };

    await expect(store.deleteProject('item')).rejects.toMatchObject({
      name: 'ProjectDeleteError',
    });
    expect(fake.text.has('/app/projects/item/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(true);
    await expect(store.getStoryCodex('item')).resolves.toEqual(legacyCodex);

    fake.apis.remove = originalRemove;
    const restarted = new FsProjectStore();
    await expect(restarted.deleteProject('item')).resolves.toBeUndefined();
    expect(fake.text.has('/app/projects/item/project.json')).toBe(false);
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(false);
  });

  // QNBS-v3: deletion revalidates persisted legacy routing so restart-time cleanup cannot orphan verified auxiliary data.
  it('hydrates persisted legacy routing before deleting an unloaded project', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    const loaded = await store.loadProject('item');
    await store.saveProject(loaded as never);
    const restarted = new FsProjectStore();

    await expect(restarted.deleteProject('item')).resolves.toBeUndefined();
    expect(fake.text.has('/app/projects/item/project.json')).toBe(false);
    expect(fake.text.has('/app/projects/project/codex/codex.snap')).toBe(false);
  });

  // QNBS-v3: deletion fails closed when project identity cannot be inspected, preserving data for a later retry.
  it('does not delete a project when its identity cannot be inspected', async () => {
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', '{corrupt');

    await expect(store.deleteProject('item')).rejects.toMatchObject({
      name: 'ProjectDeleteError',
      reason: 'identity-inspection-failed',
    });
    expect(fake.text.has('/app/projects/item/project.json')).toBe(true);
  });

  // QNBS-v3: an uncertain existence probe must preserve the project and expose a retryable typed deletion result.
  it('classifies a project existence probe failure before attempting cleanup', async () => {
    await store.saveProject(project as never);
    const originalExists = fake.apis.exists;
    const originalRemove = fake.apis.remove;
    const removeSpy = vi.fn(originalRemove);
    fake.apis.remove = removeSpy;
    fake.apis.exists = (path: string) =>
      path === '/app/projects/p1'
        ? Promise.reject(new Error('EIO: project existence unavailable'))
        : originalExists(path);

    await expect(store.deleteProject('p1')).rejects.toMatchObject({
      name: 'ProjectDeleteError',
      reason: 'identity-inspection-failed',
    });
    // Only the delete's own project-lock release may remove anything.
    expect(
      removeSpy.mock.calls.every(([path]) => String(path).startsWith('/app/project-locks/')),
    ).toBe(true);
    expect(fake.text.has('/app/projects/p1/project.json')).toBe(true);
  });

  // QNBS-v3: snapshot recovery accepts an invalid legacy identity only when its existing fallback directory proves ownership.
  it('normalizes a legacy invalid project ID restored from a filesystem snapshot', async () => {
    const legacyProject = { ...project, id: '***' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );

    const snapshotId = await store.saveSnapshot('legacy', legacyProject);
    const restored = await store.getSnapshotData(snapshotId);
    await expect(store.saveProject(restored as never)).resolves.toBeUndefined();
    await expect(store.getStoryCodex('item')).resolves.toEqual(legacyCodex);

    const persisted = decompressData<Record<string, unknown>>(
      fake.text.get('/app/projects/item/project.json') as string,
    );
    expect(persisted['id']).toBe('item');
    await expect(
      store.saveProject({ ...project, id: '***', title: 'Unrelated New Project' } as never),
    ).rejects.toThrow('Cannot save a project with an unusable project ID.');
  });

  // QNBS-v3: matching snapshot identity permits older content while keeping the filesystem target authoritative.
  it('rejects a valid snapshot from another project before changing the target', async () => {
    await store.saveProject(project as never);
    const current = await store.loadProject('p1');
    const snapshotId = await store.saveSnapshot('older', {
      ...project,
      id: 'p2',
      title: 'Older snapshot content',
      manuscript: [{ id: 's-old', title: 'Older', content: 'previous draft' }],
    });

    await expect(store.restoreSnapshot(snapshotId, current as never)).rejects.toMatchObject({
      name: 'ProjectSnapshotRestoreError',
      reason: 'snapshot-owner-mismatch',
    });
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/p1/project.json') as string,
      )['title'],
    ).toBe('My Novel');
    expect(fake.text.has('/app/projects/p2/project.json')).toBe(false);
  });

  // QNBS-v3: the best-effort cold-boot marker cannot veto a validated current filesystem target.
  it('restores a matching snapshot when the active-project marker is stale', async () => {
    const secondProject = { ...project, id: 'p2', title: 'Second Novel' };
    await store.saveProject(secondProject as never);
    const current = await store.loadProject('p2');
    const snapshotId = await store.saveSnapshot('p2-snapshot', {
      ...secondProject,
      title: 'Older second project content',
    });
    fake.text.set('/app/config/active-project-id.txt', 'p1');

    const restored = await store.restoreSnapshot(snapshotId, current as never);

    expect((restored as unknown as Record<string, unknown>)['id']).toBe('p2');
    expect(restored.title).toBe('Older second project content');
  });

  it('restores older content when the snapshot owner matches the validated target', async () => {
    await store.saveProject(project as never);
    const current = await store.loadProject('p1');
    const snapshotId = await store.saveSnapshot('older', {
      ...project,
      id: 'p1',
      title: 'Older snapshot content',
      manuscript: [{ id: 's-old', title: 'Older', content: 'previous draft' }],
    });

    const restored = await store.restoreSnapshot(snapshotId, current as never);
    const restoredRecord = restored as unknown as Record<string, unknown>;

    expect(restoredRecord['id']).toBe('p1');
    expect(restored.title).toBe('Older snapshot content');
    await store.saveProject(restored as never);
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/p1/project.json') as string,
      )['title'],
    ).toBe('Older snapshot content');
    expect(fake.text.has('/app/projects/p2/project.json')).toBe(false);
  });

  // QNBS-v3: a future snapshot cannot overwrite a current target with an unadmitted schema marker.
  it('refuses a future snapshot before it can turn a current target into future state', async () => {
    await store.saveProject(project as never);
    const current = await store.loadProject('p1');
    const snapshotId = await store.saveSnapshot('future', {
      ...project,
      schemaVersion: 99,
      title: 'Future snapshot content',
    });

    await expect(store.restoreSnapshot(snapshotId, current as never)).rejects.toMatchObject({
      name: 'ProjectSnapshotRestoreError',
      reason: 'snapshot-invalid',
    });
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/p1/project.json') as string,
      ),
    ).toMatchObject({ schemaVersion: 1, title: 'My Novel' });
  });

  // QNBS-v3: raw snapshot version tokens must be admitted before JSON parsing can normalize them.
  it.each([
    [
      'duplicate schemaVersion',
      '{"schemaVersion":1,"schemaVersion":2,"id":"p1","title":"Raw","logline":"L","manuscript":[],"characters":[],"worlds":[]}',
    ],
    [
      'unsafe numeric schemaVersion',
      '{"schemaVersion":9007199254740993,"id":"p1","title":"Raw","logline":"L","manuscript":[],"characters":[],"worlds":[]}',
    ],
  ])('refuses %s snapshot tokens before normalization', async (_label, rawSnapshot) => {
    await store.saveProject(project as never);
    const current = await store.loadProject('p1');
    const snapshotId = 9101;
    fake.text.set(
      `/app/snapshots/${snapshotId}.json`,
      JSON.stringify({
        id: snapshotId,
        name: 'raw',
        date: new Date().toISOString(),
        wordCount: 0,
        data: rawSnapshot,
      }),
    );

    await expect(store.restoreSnapshot(snapshotId, current as never)).rejects.toMatchObject({
      name: 'ProjectSnapshotRestoreError',
      reason: 'snapshot-invalid',
    });
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/p1/project.json') as string,
      ),
    ).toMatchObject({ schemaVersion: 1, title: 'My Novel' });
  });

  // QNBS-v3: pre-marker snapshots remain recoverable through the non-destructive legacy projection.
  it('restores a legacy snapshot through canonical in-memory admission', async () => {
    await store.saveProject(project as never);
    const current = await store.loadProject('p1');
    const { schemaVersion: _schemaVersion, ...legacySnapshot } = project;
    const snapshotId = await store.saveSnapshot('legacy-snapshot', {
      ...legacySnapshot,
      title: 'Legacy snapshot content',
    });

    const restored = await store.restoreSnapshot(snapshotId, current as never);

    expect(restored.title).toBe('Legacy snapshot content');
    expect((restored as unknown as Record<string, unknown>)['schemaVersion']).toBe(1);
  });

  // QNBS-v3: target-owned metadata survives a matching restore without trusting snapshot metadata.
  it('restores older normalized content and preserves target auxiliary metadata', async () => {
    const legacyProject = { ...project, id: '***', title: 'Current legacy content' };
    const legacyCodex = { projectId: '***', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    await fake.apis.mkdir('/app/projects/project/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/project/codex/codex.snap',
      compressData(legacyCodex),
    );
    const current = await store.loadProject('item');
    const snapshotId = await store.saveSnapshot('older-legacy', {
      ...legacyProject,
      id: 'item',
      title: 'Older legacy content',
      manuscript: [{ id: 's-old', title: 'Older', content: 'previous draft' }],
      __worldscriptLegacyProjectDirectory: 'project',
      __worldscriptLegacyAuxiliary: {
        legacyProjectId: 'project',
        legacyRawProjectId: '***',
        codex: false,
        binderAssetIds: ['fabricated'],
      },
    });

    const restored = await store.restoreSnapshot(snapshotId, current as never);
    const restoredRecord = restored as unknown as Record<string, unknown>;
    const metadata = restoredRecord['__worldscriptLegacyAuxiliary'] as Record<string, unknown>;

    expect(restoredRecord['id']).toBe('item');
    expect(restored.title).toBe('Older legacy content');
    expect(restoredRecord['__worldscriptLegacyProjectDirectory']).toBeUndefined();
    expect(metadata).toEqual(
      expect.objectContaining({
        legacyProjectId: 'project',
        legacyRawProjectId: '***',
        codex: true,
      }),
    );
    expect(metadata['binderAssetIds']).toEqual([]);
  });

  it('rejects a historical invalid-ID snapshot even when the target has matching legacy lineage', async () => {
    const legacyProject = { ...project, id: '***', title: 'Current legacy content' };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));
    const current = await store.loadProject('item');
    const snapshotId = await store.saveSnapshot('legacy-invalid-id', {
      ...legacyProject,
      title: 'Older legacy content',
    });

    await expect(store.restoreSnapshot(snapshotId, current as never)).rejects.toMatchObject({
      name: 'ProjectSnapshotRestoreError',
      reason: 'snapshot-owner-unverifiable',
    });
    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/item/project.json') as string,
      )['title'],
    ).toBe('Current legacy content');
  });

  // QNBS-v3: restore fails closed when no safe current filesystem target is available.
  it.each(['.', '..', '***'])(
    'rejects unsafe restore target %s without touching projects',
    async (id) => {
      const snapshotId = await store.saveSnapshot('unsafe-target', project);

      await expect(
        store.restoreSnapshot(snapshotId, { ...project, id } as never),
      ).rejects.toMatchObject({
        name: 'ProjectSnapshotRestoreError',
        reason: 'target-unavailable',
      });
      expect([...fake.text.keys()].some((path) => path.startsWith('/app/projects/'))).toBe(false);
    },
  );

  // QNBS-v3: ownerless historical snapshots fail closed instead of guessing a missing-ID target.
  it('rejects a historical missing-ID snapshot for a verified missing-ID target', async () => {
    const legacyProject = { ...project, id: undefined, title: 'Legacy Novel' };
    await fake.apis.mkdir('/app/projects/Legacy-Novel', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/Legacy-Novel/project.json',
      compressData(legacyProject),
    );
    const current = await store.loadProject('Legacy-Novel');
    const snapshotId = await store.saveSnapshot('older-missing-id', {
      ...legacyProject,
      title: 'Renamed in older snapshot',
    });

    await expect(store.restoreSnapshot(snapshotId, current as never)).rejects.toMatchObject({
      name: 'ProjectSnapshotRestoreError',
      reason: 'snapshot-owner-unverifiable',
    });
    expect(fake.text.has('/app/projects/Legacy-Novel/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/Renamed-in-older-snapshot/project.json')).toBe(false);
  });

  it('keeps a missing-ID legacy project bound to its existing title-derived directory', async () => {
    const legacyProject = { ...project, id: undefined, title: 'Legacy Novel' };
    await fake.apis.mkdir('/app/projects/Legacy-Novel', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/Legacy-Novel/project.json',
      compressData(legacyProject),
    );

    const loaded = await store.loadProject('Legacy-Novel');

    expect((loaded as unknown as Record<string, unknown>)['id']).toBeUndefined();
    await store.saveProject({ ...loaded, title: 'Renamed Novel' } as never);
    expect(fake.text.has('/app/projects/Legacy-Novel/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/Renamed-Novel/project.json')).toBe(false);

    const restarted = new FsProjectStore();
    const reloaded = await restarted.loadProject('Legacy-Novel');
    await restarted.saveProject({ ...reloaded, title: 'Renamed Again' } as never);
    expect(fake.text.has('/app/projects/Legacy-Novel/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/Renamed-Again/project.json')).toBe(false);
  });

  // QNBS-v3: a CURRENT ID-less source remains authoritative across repeated title-changing saves.
  it('retains a CURRENT ID-less source binding across repeated saves', async () => {
    const currentProject = {
      schemaVersion: 1,
      title: 'Current Novel',
      logline: 'L',
      manuscript: [],
      characters: [],
      worlds: [],
    };
    await fake.apis.mkdir('/app/projects/current-source', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/current-source/project.json',
      compressData(currentProject),
    );

    const loaded = await store.loadProject('current-source');
    await store.saveProject({ ...loaded, title: 'First Rename' } as never);
    await store.saveProject({ ...loaded, title: 'Second Rename' } as never);

    expect(
      decompressData<Record<string, unknown>>(
        fake.text.get('/app/projects/current-source/project.json') as string,
      ),
    ).toMatchObject({ schemaVersion: 1, title: 'Second Rename' });
    expect(fake.text.has('/app/projects/First-Rename/project.json')).toBe(false);
    expect(fake.text.has('/app/projects/Second-Rename/project.json')).toBe(false);
    expect(fake.text.get('/app/config/active-project-id.txt')).toBe('current-source');
  });

  // QNBS-v3: legacy missing-ID saves preserve historical Binder/Codex fallbacks without inventing cross-project ownership.
  it('keeps missing-ID legacy auxiliary data on its historical fallback paths', async () => {
    const legacyProject = { ...project, id: undefined, title: 'Legacy Novel' };
    const legacyCodex = { projectId: 'default', entries: [{ name: 'legacy' }] };
    await fake.apis.mkdir('/app/projects/Legacy-Novel', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/Legacy-Novel/project.json',
      compressData(legacyProject),
    );
    await fake.apis.mkdir('/app/projects/browser-project/binder', { recursive: true });
    await fake.apis.writeFile(
      '/app/projects/browser-project/binder/legacy-asset.bin',
      new Uint8Array([1]),
    );
    await fake.apis.writeTextFile(
      '/app/projects/browser-project/binder/legacy-asset.meta.json',
      JSON.stringify({
        mimeType: 'application/octet-stream',
        originalFileName: 'legacy.bin',
        byteSize: 1,
      }),
    );
    await fake.apis.mkdir('/app/projects/default/codex', { recursive: true });
    await fake.apis.writeTextFile(
      '/app/projects/default/codex/codex.snap',
      compressData(legacyCodex),
    );

    const loaded = await store.loadProject('Legacy-Novel');

    expect((loaded as unknown as Record<string, unknown>)['id']).toBeUndefined();
    await expect(store.getBinderAsset('browser-project', 'legacy-asset')).resolves.not.toBeNull();
    await expect(store.getStoryCodex('default')).resolves.toEqual(legacyCodex);
    await store.saveProject({ ...loaded, title: 'Renamed Novel' } as never);
    expect(fake.text.has('/app/projects/Legacy-Novel/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/Renamed-Novel/project.json')).toBe(false);
    expect(fake.bin.has('/app/projects/browser-project/binder/legacy-asset.bin')).toBe(true);
    expect(fake.text.has('/app/projects/default/codex/codex.snap')).toBe(true);
  });

  it('does not redirect a legacy project to a legitimate project-identity directory', async () => {
    const legitimateCodex = { projectId: 'project', entries: [{ name: 'legitimate' }] };
    const legitimateVectors = [{ id: 'legitimate-vector' }];
    await store.saveProject({ ...project, id: 'project', title: 'Legitimate Project' } as never);
    await store.saveStoryCodex(legitimateCodex as never);
    await store.saveRagVectors('project', legitimateVectors);
    await store.saveBinderAsset('project', 'legitimate-asset', new Uint8Array([3]).buffer, {
      mimeType: 'application/octet-stream',
      originalFileName: 'legitimate.bin',
      byteSize: 1,
    });

    const legacyProject = {
      ...project,
      id: '***',
      binderNodes: [legacyBinderNode('legitimate-asset')],
    };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));

    await expect(store.loadProject('item')).resolves.toEqual(
      expect.objectContaining({ title: 'My Novel' }),
    );
    expect(await store.getStoryCodex('item')).toBeNull();
    expect(await store.getRagVectors('item')).toEqual([]);
    expect(await store.listBinderAssetIds('item')).toEqual([]);
    expect(await store.getStoryCodex('project')).toEqual(legitimateCodex);
    expect(await store.getRagVectors('project')).toEqual(legitimateVectors);
    expect(await store.getBinderAsset('project', 'legitimate-asset')).not.toBeNull();
  });

  // QNBS-v3: ambiguous auxiliary data stays in place and unassigned rather than being exposed through a guessed legacy identity.
  it('does not assign auxiliary data without ownership evidence to a legacy project', async () => {
    const ambiguousVectors = [{ id: 'ambiguous-vector' }];
    await store.saveRagVectors('project', ambiguousVectors);
    const legacyProject = { ...project, id: '***' };
    await fake.apis.mkdir('/app/projects/item', { recursive: true });
    await fake.apis.writeTextFile('/app/projects/item/project.json', compressData(legacyProject));

    await store.loadProject('item');

    expect(await store.getRagVectors('item')).toEqual([]);
    expect(await store.getRagVectors('project')).toEqual(ambiguousVectors);
    expect(fake.text.has('/app/projects/project/codex/vectors.snap')).toBe(true);
  });

  it('rejects dot path segments without touching the project namespace', async () => {
    await store.saveProject(project as never);
    await store.saveProject({ ...project, id: 'p2', title: 'Other Novel' } as never);

    for (const invalidId of ['.', '..']) {
      await expect(store.saveProject({ ...project, id: invalidId } as never)).rejects.toThrow(
        'Cannot save a project with an unusable project ID.',
      );
      await expect(store.loadProject(invalidId)).resolves.toBeNull();
      await expect(store.deleteProject(invalidId)).resolves.toBeUndefined();
      await expect(store.quarantineProject(invalidId)).rejects.toMatchObject({
        name: 'ProjectQuarantineError',
        reason: 'not-found',
      });
    }

    expect(await store.listProjects()).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(fake.text.has('/app/projects/p1/project.json')).toBe(true);
    expect(fake.text.has('/app/projects/p2/project.json')).toBe(true);
  });

  // QNBS-v3: failed preservation must leave the affected source available for safe recovery.
  it('leaves the original project intact when quarantine cannot rename it', async () => {
    await store.saveProject(project as never);
    const original = fake.text.get('/app/projects/p1/project.json');
    fake.apis.rename = () => Promise.reject(new Error('EACCES: permission denied'));

    await expect(store.quarantineProject('p1')).rejects.toMatchObject({
      name: 'ProjectQuarantineError',
      reason: 'io-error',
      message: 'Project preservation failed. The original project was not deleted.',
    });

    expect(fake.text.get('/app/projects/p1/project.json')).toBe(original);
    expect(await store.listProjects()).toContain('p1');
  });

  // QNBS-v3: the store test protects the non-blocking scheduling seam without asserting a verdict authority.
  it('returns the decoded project without waiting for or adopting the shadow verdict', async () => {
    await store.saveProject(project as never);
    const loaded = await store.loadProject('p1');

    expect(loaded).toEqual(expect.objectContaining({ title: 'My Novel' }));
    expect(shadowValidation).toHaveBeenCalledTimes(1);
    expect(shadowValidation).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Novel' }));
  });

  // QNBS-v3 (#332): saveProject records the active-project marker so cold boot doesn't pick an arbitrary readDir() entry.
  it('records the saved project as the active-project marker, updating it on each subsequent save', async () => {
    expect(await store.getActiveProjectId()).toBeNull();

    await store.saveProject(project as never);
    expect(await store.getActiveProjectId()).toBe('p1');

    const secondProject = { ...project, id: 'p2', title: 'Second Novel' };
    await store.saveProject(secondProject as never);
    expect(await store.getActiveProjectId()).toBe('p2');
  });

  // QNBS-v3 (#332): a rejected marker write is a documented best-effort abort — it must not fail the project save that already succeeded.
  it('still resolves saveProject and logs a warning when the active-project marker write rejects', async () => {
    const originalWriteTextFile = fake.apis.writeTextFile;
    fake.apis.writeTextFile = (p: string, c: string) => {
      if (p.includes('active-project-id.txt')) return Promise.reject(new Error('disk full'));
      return originalWriteTextFile(p, c);
    };

    await expect(store.saveProject(project as never)).resolves.toBeUndefined();
    expect(await store.loadProject('p1')).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to persist active-project marker (project save itself succeeded)',
      expect.objectContaining({ error: 'disk full' }),
    );
  });

  it('keeps the previous project when the replacement write fails', async () => {
    await store.saveProject(project as never);
    const originalWriteTextFile = fake.apis.writeTextFile;
    fake.apis.writeTextFile = (path: string, content: string) => {
      if (path.includes('/project.json.tmp-')) return Promise.reject(new Error('disk full'));
      return originalWriteTextFile(path, content);
    };

    await expect(
      store.saveProject({ ...project, title: 'Should not replace' } as never),
    ).rejects.toMatchObject({
      name: 'ProjectCanonicalWritebackError',
      projectId: 'p1',
      message:
        'Project save was refused to preserve the stored data. Reload the project and try again.',
      detail: expect.stringContaining('disk full'),
    });
    expect((await store.loadProject('p1'))?.title).toBe('My Novel');
    expect([...fake.text.keys()].some((path) => path.includes('.tmp-'))).toBe(false);
  });
});

// QNBS-v3 (#553): two FsProjectStore instances over one filesystem are two WorldScript processes. The #826 lock serializes their writes; these prove the load-generation baseline additionally refuses a writer whose snapshot predates another window's commit, instead of silently reverting that window's fields.
describe('FsProjectStore — stale independently-loaded writer', () => {
  const PROJECT_FILE = '/app/projects/p1/project.json';
  const base = {
    id: 'p1',
    schemaVersion: 1,
    title: 'Original',
    logline: 'Original logline',
    manuscript: [{ id: 's1', title: 'Ch1', content: 'hello' }],
    characters: [],
    worlds: [],
  };
  const persisted = () =>
    JSON.parse(decompressJsonText(fake.text.get(PROJECT_FILE) as string)) as Record<
      string,
      unknown
    >;

  async function twoWindowsLoadedAtG0(): Promise<[FsProjectStore, FsProjectStore]> {
    await store.saveProject(base as never);
    const windowA = new FsProjectStore();
    const windowB = new FsProjectStore();
    await windowA.loadProjectForEditing('p1');
    await windowB.loadProjectForEditing('p1');
    return [windowA, windowB];
  }

  it('refuses the second window instead of reverting the first window’s committed field', async () => {
    const [windowA, windowB] = await twoWindowsLoadedAtG0();

    await windowA.saveProject({ ...base, title: 'Changed by A' } as never);
    await expect(
      windowB.saveProject({ ...base, logline: 'Changed by B' } as never),
    ).rejects.toBeInstanceOf(StaleProjectWriterError);

    expect(persisted()).toMatchObject({ title: 'Changed by A', logline: 'Original logline' });
  });

  it('lets the same window keep saving after its own commits', async () => {
    const [windowA] = await twoWindowsLoadedAtG0();

    await windowA.saveProject({ ...base, title: 'First' } as never);
    await windowA.saveProject({ ...base, title: 'Second' } as never);
    await windowA.saveProject({ ...base, title: 'Third' } as never);

    expect(persisted()).toMatchObject({ title: 'Third' });
  });

  it('lets the refused window save again once it reloads the current generation', async () => {
    const [windowA, windowB] = await twoWindowsLoadedAtG0();
    await windowA.saveProject({ ...base, title: 'Changed by A' } as never);
    await expect(windowB.saveProject({ ...base } as never)).rejects.toBeInstanceOf(
      StaleProjectWriterError,
    );

    const reloaded = await windowB.loadProjectForEditing('p1');
    await windowB.saveProject({ ...(reloaded as object), logline: 'B after reload' } as never);

    expect(persisted()).toMatchObject({ title: 'Changed by A', logline: 'B after reload' });
  });

  it('does not let a background read move the editing baseline and mask the conflict', async () => {
    const [windowA, windowB] = await twoWindowsLoadedAtG0();
    await windowA.saveProject({ ...base, title: 'Changed by A' } as never);

    // Backup/LoRA-style read of the newer generation by the stale window itself.
    expect((await windowB.loadProject('p1'))?.title).toBe('Changed by A');
    await expect(
      windowB.saveProject({ ...base, logline: 'Changed by B' } as never),
    ).rejects.toBeInstanceOf(StaleProjectWriterError);
    expect(persisted()).toMatchObject({ title: 'Changed by A' });
  });

  it('refuses a stale writer before anything is written, leaving no temp file behind', async () => {
    const [windowA, windowB] = await twoWindowsLoadedAtG0();
    await windowA.saveProject({ ...base, title: 'Changed by A' } as never);
    const before = fake.text.get(PROJECT_FILE);

    await expect(windowB.saveProject({ ...base } as never)).rejects.toBeInstanceOf(
      StaleProjectWriterError,
    );

    expect(fake.text.get(PROJECT_FILE)).toBe(before);
    expect([...fake.text.keys()].some((path) => path.includes('.tmp-'))).toBe(false);
    expect([...fake.text.keys()].some((path) => path.endsWith('.lock'))).toBe(false);
  });

  it('keeps the creating window fenced if another window saves its new file first', async () => {
    const creator = new FsProjectStore();
    await creator.saveProject(base as never);
    const other = new FsProjectStore();
    await other.loadProjectForEditing('p1');
    await other.saveProject({ ...base, title: 'Changed by other' } as never);

    await expect(
      creator.saveProject({ ...base, logline: 'Stale creator edit' } as never),
    ).rejects.toBeInstanceOf(StaleProjectWriterError);
    expect(persisted()).toMatchObject({ title: 'Changed by other', logline: 'Original logline' });
  });

  it('lets the creating window keep saving its own new file', async () => {
    const creator = new FsProjectStore();
    await creator.saveProject(base as never);
    await creator.saveProject({ ...base, title: 'Creator second save' } as never);
    expect(persisted()).toMatchObject({ title: 'Creator second save' });
  });

  it.each([
    ['deleted', (w: FsProjectStore) => w.deleteProject('p1')],
    ['quarantined', (w: FsProjectStore) => w.quarantineProject('p1')],
  ])('refuses to resurrect a project another window %s', async (_label, remove) => {
    const [windowA, windowB] = await twoWindowsLoadedAtG0();
    await remove(windowA);

    await expect(
      windowB.saveProject({ ...base, title: 'Stale resurrection' } as never),
    ).rejects.toBeInstanceOf(StaleProjectWriterError);
    expect(fake.text.has(PROJECT_FILE)).toBe(false);
  });

  it('lets a window recreate a project it deleted itself', async () => {
    const [windowA] = await twoWindowsLoadedAtG0();
    await windowA.deleteProject('p1');
    await windowA.saveProject({ ...base, title: 'Recreated by its own deleter' } as never);
    expect(persisted()).toMatchObject({ title: 'Recreated by its own deleter' });
  });

  it('keeps today’s behavior for a window that never loaded the project for editing', async () => {
    await store.saveProject(base as never);
    const other = new FsProjectStore();
    await other.saveProject({ ...base, title: 'Saved without an editing load' } as never);
    expect(persisted()).toMatchObject({ title: 'Saved without an editing load' });
  });

  describe('auxiliary image/binder/codex writes', () => {
    const meta = { name: 'a.pdf', mimeType: 'application/pdf', byteSize: 0 } as never;
    const auxiliaryWrites: [string, (w: FsProjectStore) => Promise<void>][] = [
      ['saveImage', (w) => w.saveImage('c1', 'data:image/png;base64,AAAA', 'p1')],
      ['deleteImage', (w) => w.deleteImage('c1', 'p1')],
      ['saveBinderAsset', (w) => w.saveBinderAsset('p1', 'a1', new ArrayBuffer(3), meta)],
      ['deleteBinderAsset', (w) => w.deleteBinderAsset('p1', 'a1')],
      ['deleteAllBinderAssetsForProject', (w) => w.deleteAllBinderAssetsForProject('p1')],
      ['saveStoryCodex', (w) => w.saveStoryCodex({ projectId: 'p1', entries: [] } as never)],
      ['deleteStoryCodex', (w) => w.deleteStoryCodex('p1')],
    ];
    const diskSnapshot = () =>
      [...fake.text.entries(), ...fake.bin.entries()].map(([k, v]) => `${k}=${String(v)}`);

    it.each(auxiliaryWrites)(
      'refuses %s from a window another window moved past',
      async (_label, write) => {
        const [windowA, windowB] = await twoWindowsLoadedAtG0();
        await windowA.saveProject({ ...base, title: 'Changed by A' } as never);
        const before = diskSnapshot();

        await expect(write(windowB)).rejects.toBeInstanceOf(StaleProjectWriterError);
        expect(diskSnapshot()).toEqual(before);
      },
    );

    it.each(auxiliaryWrites)(
      'refuses %s after another window deleted the project',
      async (_label, write) => {
        const [windowA, windowB] = await twoWindowsLoadedAtG0();
        await windowA.deleteProject('p1');

        await expect(write(windowB)).rejects.toBeInstanceOf(StaleProjectWriterError);
      },
    );

    it.each(auxiliaryWrites)('lets a current window run %s', async (_label, write) => {
      const [windowA] = await twoWindowsLoadedAtG0();
      await windowA.saveProject({ ...base, title: 'Own commit' } as never);
      await expect(write(windowA)).resolves.toBeUndefined();
    });

    it.each(auxiliaryWrites)(
      'keeps %s unfenced for a window that never edit-loaded',
      async (_label, write) => {
        await store.saveProject(base as never);
        await new FsProjectStore().saveProject({ ...base, title: 'Other' } as never);
        await expect(write(new FsProjectStore())).resolves.toBeUndefined();
      },
    );

    it.each(auxiliaryWrites)(
      'fails %s closed when the fence cannot read the project file',
      async (_label, write) => {
        const [windowA] = await twoWindowsLoadedAtG0();
        vi.spyOn(fake.apis, 'exists').mockRejectedValue(new Error('EIO'));
        await expect(write(windowA)).rejects.toBeInstanceOf(ProjectCanonicalWritebackError);
      },
    );

    it.each(auxiliaryWrites)(
      'holds the project lock across %s so no commit can land between check and write',
      async (_label, write) => {
        const [windowA] = await twoWindowsLoadedAtG0();
        await fake.apis.mkdir('/app/project-locks', { recursive: true });
        await fake.apis.writeTextFile('/app/project-locks/p1.lock', 'held by another window');
        const before = diskSnapshot();

        await expect(write(windowA)).rejects.toBeInstanceOf(ProjectFileLockedError);
        expect(diskSnapshot()).toEqual(before);
      },
    );

    it('fences a codex write routed into a legacy directory under that directory’s baseline', async () => {
      const [windowA, windowB] = await twoWindowsLoadedAtG0();
      (
        windowB as unknown as {
          registerLegacyAuxiliaryPolicy(
            projectId: string,
            legacyProjectId: string,
            policy: { codex: boolean; binderAssetIds: ReadonlySet<string> },
          ): void;
        }
      ).registerLegacyAuxiliaryPolicy('alias', 'p1', { codex: true, binderAssetIds: new Set() });
      await windowA.saveProject({ ...base, title: 'Changed by A' } as never);

      await expect(
        windowB.saveStoryCodex({ projectId: 'alias', entries: [] } as never),
      ).rejects.toBeInstanceOf(StaleProjectWriterError);
      expect(fake.text.has('/app/projects/p1/codex/codex.snap')).toBe(false);
    });

    it('fences a binder write only against the directory that asset is routed to', async () => {
      await store.saveProject(base as never);
      await store.saveProject({ ...base, id: 'legacy', title: 'Legacy' } as never);
      const windowA = new FsProjectStore();
      const windowB = new FsProjectStore();
      await windowB.loadProjectForEditing('p1');
      await windowB.loadProjectForEditing('legacy');
      await windowA.loadProjectForEditing('legacy');
      await windowA.saveProject({ ...base, id: 'legacy', title: 'Legacy changed by A' } as never);
      (
        windowB as unknown as {
          registerLegacyAuxiliaryPolicy(
            projectId: string,
            legacyProjectId: string,
            policy: { codex: boolean; binderAssetIds: ReadonlySet<string> },
          ): void;
        }
      ).registerLegacyAuxiliaryPolicy('p1', 'legacy', {
        codex: false,
        binderAssetIds: new Set(['old']),
      });

      await expect(
        windowB.saveBinderAsset('p1', 'fresh', new ArrayBuffer(3), meta),
      ).resolves.toBeUndefined();
      await expect(
        windowB.saveBinderAsset('p1', 'old', new ArrayBuffer(3), meta),
      ).rejects.toBeInstanceOf(StaleProjectWriterError);
    });

    const withPolicy = (w: FsProjectStore, projectId: string, legacyId: string, codex: boolean) =>
      (
        w as unknown as {
          registerLegacyAuxiliaryPolicy(
            projectId: string,
            legacyProjectId: string,
            policy: { codex: boolean; binderAssetIds: ReadonlySet<string> },
          ): void;
        }
      ).registerLegacyAuxiliaryPolicy(projectId, legacyId, {
        codex,
        binderAssetIds: new Set(codex ? [] : ['old']),
      });

    it('fences a routed codex write by the logical project’s baseline too', async () => {
      const [windowA, windowB] = await twoWindowsLoadedAtG0();
      withPolicy(windowB, 'p1', 'legacy', true);
      await windowA.saveProject({ ...base, title: 'Changed by A' } as never);

      await expect(
        windowB.saveStoryCodex({ projectId: 'p1', entries: [] } as never),
      ).rejects.toBeInstanceOf(StaleProjectWriterError);
      expect(fake.text.has('/app/projects/legacy/codex/codex.snap')).toBe(false);
    });

    it('locks a write even for a window with no baseline, so it cannot interleave with a delete', async () => {
      await store.saveProject(base as never);
      await fake.apis.mkdir('/app/project-locks', { recursive: true });
      await fake.apis.writeTextFile('/app/project-locks/p1.lock', 'held by a delete');

      await expect(
        new FsProjectStore().saveStoryCodex({ projectId: 'p1', entries: [] } as never),
      ).rejects.toBeInstanceOf(ProjectFileLockedError);
      expect(fake.text.has('/app/projects/p1/codex/codex.snap')).toBe(false);
    });

    it('locks the routed legacy directory a delete also empties', async () => {
      await store.saveProject(base as never);
      withPolicy(store, 'p1', 'legacy', true);
      await fake.apis.mkdir('/app/project-locks', { recursive: true });
      await fake.apis.writeTextFile('/app/project-locks/legacy.lock', 'held by a codex write');

      await expect(store.deleteProject('p1')).rejects.toBeInstanceOf(ProjectFileLockedError);
      expect(fake.text.has(PROJECT_FILE)).toBe(true);
    });

    it('lets the refused window write assets again after reloading', async () => {
      const [windowA, windowB] = await twoWindowsLoadedAtG0();
      await windowA.saveProject({ ...base, title: 'Changed by A' } as never);
      await expect(
        windowB.saveImage('c1', 'data:image/png;base64,AAAA', 'p1'),
      ).rejects.toBeInstanceOf(StaleProjectWriterError);

      await windowB.loadProjectForEditing('p1');
      await windowB.saveImage('c1', 'data:image/png;base64,AAAA', 'p1');
      expect(await windowB.getImage('c1', 'p1')).toBe('data:image/png;base64,AAAA');
    });
  });
});

describe('FsSettingsStore — settings + encrypted API keys', () => {
  it('round-trips settings and applies collaboration/integrations defaults', async () => {
    await store.saveSettings({} as never);
    const loaded = await store.loadSettings();
    expect(loaded?.collaboration).toBeDefined();
    expect(loaded?.integrations).toBeDefined();
  });

  it('returns null when no settings file exists', async () => {
    expect(await store.loadSettings()).toBeNull();
  });

  it('rejects filesystem API-key persistence', async () => {
    await expect(store.saveApiKey('openai', 'test-provider-key')).rejects.toThrow(/disabled/);
  });

  it('does not read legacy filesystem API-key files', async () => {
    const keyFile = '/app/config/openai_key.enc.json';
    fake.text.set(keyFile, JSON.stringify({ iv: 'legacy', data: 'legacy' }));
    expect(await store.getApiKey('openai')).toBeNull();
    expect(fake.text.has(keyFile)).toBe(false);
  });

  it('rejects filesystem API-key persistence even for an empty key', async () => {
    await expect(store.saveApiKey('openai', '  ')).rejects.toThrow(/disabled/);
  });

  it('returns null when no filesystem key exists', async () => {
    expect(await store.getApiKey('anthropic')).toBeNull();
  });

  it('removes known legacy API-key files during desktop startup cleanup', async () => {
    const providers = ['gemini', 'openai', 'anthropic', 'grok', 'openrouter'];
    for (const provider of providers) {
      fake.text.set(`/app/config/${provider}_key.enc.json`, 'legacy-ciphertext');
    }

    await store.removeLegacyApiKeyFiles();

    expect(
      providers.every((provider) => !fake.text.has(`/app/config/${provider}_key.enc.json`)),
    ).toBe(true);
  });

  // QNBS-v3 (CodeRabbit #363): regression guard — a hardcoded provider list would leave an unlisted/future provider's legacy file uncleaned forever, since cleanup now scans by filename pattern instead.
  it('removes a legacy key file for a provider not in any hardcoded list, and leaves other files alone', async () => {
    fake.text.set('/app/config/some-future-provider_key.enc.json', 'legacy-ciphertext');
    fake.text.set('/app/config/settings.json', '{"kept":true}');

    await store.removeLegacyApiKeyFiles();

    expect(fake.text.has('/app/config/some-future-provider_key.enc.json')).toBe(false);
    expect(fake.text.has('/app/config/settings.json')).toBe(true);
  });

  // QNBS-v3: [security / discard recoverable legacy ciphertext / prevents unsafe migration].
  it('discards a legacy unsalted key file without notifying or throwing', async () => {
    const dispatch = vi.fn();
    appStoreRef.current = { getState: vi.fn(), dispatch } as never;
    try {
      const legacyFile = '/app/config/legacyprovider_key.enc.json';
      fake.text.set(
        legacyFile,
        JSON.stringify({ iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAA' }),
      );

      const result = await store.getApiKey('legacyprovider');

      expect(result).toBeNull();
      expect(fake.text.has(legacyFile)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      appStoreRef.current = null;
    }
  });

  // QNBS-v3 (Codecov-flagged missing line): the discard path's own cleanup can itself fail (e.g.
  // the file is locked or already gone) — asserts that failure is swallowed (logged, not thrown)
  // rather than surfacing as an unhandled rejection from getApiKey.
  it('swallows a failure to remove the stale legacy key file (cleanup-of-cleanup)', async () => {
    const legacyFile = '/app/config/legacyprovider2_key.enc.json';
    fake.text.set(legacyFile, JSON.stringify({ iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAA' }));
    fake.apis.remove = () => Promise.reject(new Error('EBUSY: file is locked'));

    await expect(store.getApiKey('legacyprovider2')).resolves.toBeNull();
  });
});

describe('FsSnapshotStore — snapshots', () => {
  it('saves, reads, lists and deletes a snapshot, and reports saved data', async () => {
    const id = await store.saveSnapshot('auto', { manuscript: [{ content: 'one two' }] });
    expect(typeof id).toBe('number');

    expect(await store.getSnapshotData(id)).toEqual({ manuscript: [{ content: 'one two' }] });

    const list = await store.listSnapshots();
    expect(list.map((s) => s.id)).toContain(id);
    expect(list[0]?.wordCount).toBe(2);

    await store.deleteSnapshot(id);
    expect(await store.getSnapshotData(id)).toBeNull();
  });

  it('returns null/[] for missing snapshots', async () => {
    expect(await store.getSnapshotData(123)).toBeNull();
    expect(await store.listSnapshots()).toEqual([]);
    expect(await store.hasSavedData()).toBe(false);
  });
});

describe('FsCodexStore — codex + RAG vectors', () => {
  it('round-trips a story codex', async () => {
    await store.saveStoryCodex({ projectId: 'p1', entries: [{ k: 'v' }] } as never);
    const codex = await store.getStoryCodex('p1');
    expect((codex as { projectId?: string })?.projectId).toBe('p1');
    await store.deleteStoryCodex('p1');
    expect(await store.getStoryCodex('p1')).toBeNull();
  });

  it('round-trips RAG vectors and defaults to [] when absent', async () => {
    expect(await store.getRagVectors('p1')).toEqual([]);
    await store.saveRagVectors('p1', [{ id: 1 }, { id: 2 }]);
    expect(await store.getRagVectors('p1')).toEqual([{ id: 1 }, { id: 2 }]);
    await store.deleteRagVectors('p1');
    expect(await store.getRagVectors('p1')).toEqual([]);
  });
});

describe('FsAssetStore — images + binder assets', () => {
  it('round-trips an image while preserving its data-url MIME type', async () => {
    await store.saveImage('char-1', 'data:image/webp;base64,QUJD', 'proj-1');
    expect(await store.getImage('char-1', 'proj-1')).toBe('data:image/webp;base64,QUJD');
    await store.deleteImage('char-1', 'proj-1');
    expect(await store.getImage('char-1', 'proj-1')).toBeNull();
  });

  it('does not replace an image when final write admission rejects the incarnation', async () => {
    await store.saveImage('guarded', 'data:image/png;base64,OLD', 'proj-1');
    const filesBeforeRejectedWrite = new Map(fake.text);
    const admission = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('stale project incarnation');
      });

    await expect(
      store.saveImage('guarded', 'data:image/png;base64,NEW', 'proj-1', admission),
    ).rejects.toThrow('stale project incarnation');
    expect(admission).toHaveBeenCalledTimes(2);
    expect(fake.text).toEqual(filesBeforeRejectedWrite);
    expect(await store.getImage('guarded', 'proj-1')).toBe('data:image/png;base64,OLD');
  });

  it('does not delete an image when delete admission rejects the incarnation', async () => {
    await store.saveImage('delete-guarded', 'data:image/png;base64,OLD', 'proj-1');
    const admission = vi.fn(() => {
      throw new Error('stale project incarnation');
    });

    await expect(store.deleteImage('delete-guarded', 'proj-1', admission)).rejects.toThrow(
      'stale project incarnation',
    );
    expect(admission).toHaveBeenCalledTimes(1);
    expect(await store.getImage('delete-guarded', 'proj-1')).toBe('data:image/png;base64,OLD');
  });

  // QNBS-v3: [Grund: stale no-op deletion / Impact: reject obsolete entity removal / Kreativer Mehrwert: keep missing-file cleanup under project authority]
  it('checks delete admission even when both image files are already absent', async () => {
    const admission = vi.fn(() => {
      throw new Error('stale project incarnation');
    });

    await expect(store.deleteImage('missing-image', 'proj-1', admission)).rejects.toThrow(
      'stale project incarnation',
    );
    expect(admission).toHaveBeenCalledTimes(1);
  });

  it('rechecks delete admission after a transient filesystem retry', async () => {
    await store.saveImage('delete-retry', 'data:image/png;base64,OLD', 'proj-1');
    const qualified = qualifiedImageKey('delete-retry');
    expect(qualified).toBeDefined();
    const originalRemove = fake.apis.remove;
    let removeAttempts = 0;
    fake.apis.remove = (path: string, options?: { recursive?: boolean }) => {
      if (path === qualified && removeAttempts++ === 0) {
        return Promise.reject(new Error('resource busy'));
      }
      return originalRemove(path, options);
    };
    const admission = vi.fn(() => undefined);

    try {
      await store.deleteImage('delete-retry', 'proj-1', admission);
    } finally {
      fake.apis.remove = originalRemove;
    }

    expect(removeAttempts).toBe(2);
    expect(admission).toHaveBeenCalledTimes(3);
    expect(await store.getImage('delete-retry', 'proj-1')).toBeNull();
  });

  // QNBS-v3: a replacement must wait for a pending delete so the delete cannot remove the replacement after its atomic rename.
  it('serializes a replacement behind a deferred image removal', async () => {
    await store.saveImage('replace-race', 'data:image/png;base64,OLD', 'proj-1');
    const qualified = qualifiedImageKey('replace-race');
    expect(qualified).toBeDefined();

    const originalRemove = fake.apis.remove;
    const originalWriteTextFile = fake.apis.writeTextFile;
    let releaseRemoval!: () => void;
    let removalStarted = false;
    const removalReleased = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    let replacementWriteStarted = false;

    fake.apis.remove = async (path: string, options?: { recursive?: boolean }) => {
      if (path === qualified) {
        removalStarted = true;
        await removalReleased;
      }
      return originalRemove(path, options);
    };
    fake.apis.writeTextFile = (path: string, content: string) => {
      if (path.includes('.tmp-')) replacementWriteStarted = true;
      return originalWriteTextFile(path, content);
    };

    try {
      const deletePromise = store.deleteImage('replace-race', 'proj-1');
      await vi.waitFor(() => expect(removalStarted).toBe(true));
      const replacementPromise = store.saveImage(
        'replace-race',
        'data:image/png;base64,NEW',
        'proj-1',
      );

      expect(replacementWriteStarted).toBe(false);
      releaseRemoval();
      await Promise.all([deletePromise, replacementPromise]);
    } finally {
      fake.apis.remove = originalRemove;
      fake.apis.writeTextFile = originalWriteTextFile;
      releaseRemoval();
    }

    expect(await store.getImage('replace-race', 'proj-1')).toBe('data:image/png;base64,NEW');
  });

  it('treats legacy raw image payloads as PNG', async () => {
    await store.saveImage('legacy-char', 'QUJD', 'proj-1');
    expect(await store.getImage('legacy-char', 'proj-1')).toBe('data:image/png;base64,QUJD');
  });

  it('writes new images under a per-project subdirectory, not the flat legacy path', async () => {
    await store.saveImage('char-1', 'data:image/webp;base64,QUJD', 'proj-1');
    expect(fake.text.has('/app/images/char-1.png')).toBe(false);
    // QNBS-v3: asserts the qualified write landed somewhere under images/ with a digest-qualified filename, without pinning the exact digest (an implementation detail).
    const qualifiedKeys = [...fake.text.keys()].filter(
      (k) => k.startsWith('/app/images/') && k.includes('/char-1--') && k.endsWith('.png'),
    );
    expect(qualifiedKeys).toHaveLength(1);
    expect(await store.getImage('char-1', 'proj-1')).toBe('data:image/webp;base64,QUJD');
  });

  // QNBS-v3: table-driven -- these 4 cases previously repeated as separate but identically-shaped functions (one shared helper call with different literal data), which CodeScene's Code Duplication biomarker flagged as a hotspot; one parametrized test removes the repeated shape entirely instead of relocating it.
  type CollisionCase = { entityId: string; projectId: string; value: string };
  const noImageCollisionCases: [string, CollisionCase, CollisionCase][] = [
    [
      'two distinct entity ids that sanitize to the same readable prefix',
      {
        entityId: 'alpha beta',
        projectId: 'proj-1',
        value: 'data:image/png;base64,FROM_ALPHA_SPACE',
      },
      {
        entityId: 'alpha-beta',
        projectId: 'proj-1',
        value: 'data:image/png;base64,FROM_ALPHA_HYPHEN',
      },
    ],
    [
      'two distinct project ids that sanitize to the same readable prefix',
      {
        entityId: 'char-1',
        projectId: 'alpha beta',
        value: 'data:image/png;base64,FROM_ALPHA_SPACE',
      },
      {
        entityId: 'char-1',
        projectId: 'alpha-beta',
        value: 'data:image/png;base64,FROM_ALPHA_HYPHEN',
      },
    ],
    [
      'project ids differing only by a forbidden-character substitution',
      { entityId: 'char-1', projectId: 'alpha/beta', value: 'data:image/png;base64,FROM_SLASH' },
      {
        entityId: 'char-1',
        projectId: 'alpha\\beta',
        value: 'data:image/png;base64,FROM_BACKSLASH',
      },
    ],
    [
      'long project ids that differ only after sanitizer truncation',
      {
        entityId: 'char-1',
        projectId: `${'x'.repeat(120)}-A`,
        value: 'data:image/png;base64,FROM_LONG_A',
      },
      {
        entityId: 'char-1',
        projectId: `${'x'.repeat(120)}-B`,
        value: 'data:image/png;base64,FROM_LONG_B',
      },
    ],
  ];

  it.each(noImageCollisionCases)('does not collide %s', async (_label, first, second) => {
    await store.saveImage(first.entityId, first.value, first.projectId);
    await store.saveImage(second.entityId, second.value, second.projectId);
    expect(await store.getImage(first.entityId, first.projectId)).toBe(first.value);
    expect(await store.getImage(second.entityId, second.projectId)).toBe(second.value);
  });

  // QNBS-v3: a pre-migration flat-path image (written before project-qualified keys existed) must stay reachable without a forced migration.
  it('falls back to the legacy flat image path when the project-qualified file is absent', async () => {
    fake.text.set('/app/images/legacy-only.png', 'data:image/png;base64,OLD');
    expect(await store.getImage('legacy-only', 'proj-1')).toBe('data:image/png;base64,OLD');
  });

  it('deletes both the project-qualified and legacy flat image files once ownership is claimed', async () => {
    // QNBS-v3: deleteImage never establishes a first claim itself, so the owning project must already hold it -- matches the real lifecycle where a prior getImage call claims the namespace.
    simulateLegacyImageOwner('proj-1');
    fake.text.set('/app/images/dual.png', 'data:image/png;base64,LEGACYCOPY');
    await store.saveImage('dual', 'data:image/png;base64,NEWCOPY', 'proj-1');
    await store.deleteImage('dual', 'proj-1');
    expect(await store.getImage('dual', 'proj-1')).toBeNull();
    expect(fake.text.has('/app/images/dual.png')).toBe(false);
  });

  // QNBS-v3: each irreversible filesystem removal is independently admitted, so a stale boundary stops the ordered cleanup before the next file while preserving the qualified image as the safe fallback.
  it('stops before the next image removal when authority changes between files', async () => {
    simulateLegacyImageOwner('proj-1');
    fake.text.set('/app/images/delete-boundary.png', 'data:image/png;base64,LEGACY');
    await store.saveImage('delete-boundary', 'data:image/png;base64,QUALIFIED', 'proj-1');
    const admission = vi.fn(() => {
      if (admission.mock.calls.length > 1) throw new Error('stale project incarnation');
      return undefined;
    });

    await expect(store.deleteImage('delete-boundary', 'proj-1', admission)).rejects.toThrow(
      'stale project incarnation',
    );
    expect(fake.text.has('/app/images/delete-boundary.png')).toBe(false);
    expect(qualifiedImageKey('delete-boundary')).toBeDefined();
    expect(await store.getImage('delete-boundary', 'proj-1')).toBe(
      'data:image/png;base64,QUALIFIED',
    );
  });

  // QNBS-v3: writes the persisted legacy-image-ownership marker directly, simulating a prior claim by projectId (as if it had already consulted the legacy fallback once).
  function simulateLegacyImageOwner(projectId: string) {
    fake.text.set('/app/images/.legacy-owner', projectId);
  }

  // QNBS-v3: a legacy image has no recorded owner -- once a different project has already claimed the legacy namespace, serving it to any other project risks cross-project misattribution. A live directory-count heuristic would not survive a delete-then-create cycle, so ownership is a persisted claim, not a live count.
  it('fails closed on the legacy fallback when a different project already claimed the legacy namespace', async () => {
    simulateLegacyImageOwner('proj-a');
    fake.text.set('/app/images/ambiguous.png', 'data:image/png;base64,AMBIGUOUS');

    expect(await store.getImage('ambiguous', 'proj-b')).toBeNull();
    // QNBS-v3: preserved untouched, not destructively deleted, despite being unattributable.
    expect(fake.text.has('/app/images/ambiguous.png')).toBe(true);
  });

  it('claims the legacy namespace for the first project that ever consults it', async () => {
    fake.text.set('/app/images/solo.png', 'data:image/png;base64,SOLO');

    expect(await store.getImage('solo', 'proj-1')).toBe('data:image/png;base64,SOLO');
    expect(fake.text.get('/app/images/.legacy-owner')).toBe('proj-1');
  });

  it('still serves the legacy fallback for the project that already owns the legacy namespace', async () => {
    simulateLegacyImageOwner('proj-1');
    fake.text.set('/app/images/solo.png', 'data:image/png;base64,SOLO');

    expect(await store.getImage('solo', 'proj-1')).toBe('data:image/png;base64,SOLO');
  });

  // QNBS-v3: finds the qualified (per-project digest directory, digest-qualified filename) key for an entity, distinct from the flat legacy key at /app/images/<id>.png.
  function qualifiedImageKey(entityId: string): string | undefined {
    return [...fake.text.keys()].find(
      (k) =>
        k.startsWith('/app/images/') &&
        k !== `/app/images/${entityId}.png` &&
        k.includes(`/${entityId}--`) &&
        k.endsWith('.png'),
    );
  }

  it('does not delete the legacy copy when a different project already claimed the legacy namespace', async () => {
    simulateLegacyImageOwner('proj-a');
    fake.text.set('/app/images/shared-legacy.png', 'data:image/png;base64,SHARED');
    await store.saveImage('shared-legacy', 'data:image/png;base64,NEWCOPY', 'proj-b');

    await store.deleteImage('shared-legacy', 'proj-b');

    expect(qualifiedImageKey('shared-legacy')).toBeUndefined();
    expect(fake.text.has('/app/images/shared-legacy.png')).toBe(true);
  });

  // QNBS-v3: preserve-first -- a destructive delete must never itself establish the first ownership claim, so with no prior claim the unattributed legacy copy is left untouched rather than guessed-and-destroyed.
  it('does not delete the legacy copy when this project has not yet claimed the legacy namespace', async () => {
    fake.text.set('/app/images/unclaimed-legacy.png', 'data:image/png;base64,UNCLAIMED');
    await store.saveImage('unclaimed-legacy', 'data:image/png;base64,NEWCOPY', 'proj-1');

    await store.deleteImage('unclaimed-legacy', 'proj-1');

    expect(qualifiedImageKey('unclaimed-legacy')).toBeUndefined();
    expect(fake.text.has('/app/images/unclaimed-legacy.png')).toBe(true);
  });

  // QNBS-v3: legacy must be removed before the qualified file -- if legacy removal fails, the qualified file must survive untouched so getImage's fallback can never resurrect a half-deleted image.
  it('leaves the qualified file untouched when legacy deletion fails (sole-owner case)', async () => {
    simulateLegacyImageOwner('proj-1');
    fake.text.set('/app/images/atomic.png', 'data:image/png;base64,LEGACY');
    await store.saveImage('atomic', 'data:image/png;base64,QUALIFIED', 'proj-1');

    const originalRemove = fake.apis.remove;
    fake.apis.remove = (p: string) => {
      if (p === '/app/images/atomic.png') return Promise.reject(new Error('simulated I/O failure'));
      return originalRemove(p);
    };
    try {
      await store.deleteImage('atomic', 'proj-1');
    } finally {
      fake.apis.remove = originalRemove;
    }

    expect(fake.text.has('/app/images/atomic.png')).toBe(true);
    expect(qualifiedImageKey('atomic')).toBeDefined();
    expect(await store.getImage('atomic', 'proj-1')).toBe('data:image/png;base64,QUALIFIED');
  });

  // QNBS-v3: the ownership check and the legacy-file read/delete must not be two separately-awaited, unserialized steps -- a concurrent project creation between them could make the ownership verdict stale. Proves getImage participates in the same legacy-routing serialization queue as every other mutation, so a call enqueued first blocks a call enqueued after it from even starting its own body, not just from finishing first.
  it('serializes getImage calls so a call enqueued first blocks a later call from starting until it completes', async () => {
    fake.text.set('/app/images/first.png', 'data:image/png;base64,FIRST');
    fake.text.set('/app/images/second.png', 'data:image/png;base64,SECOND');

    // QNBS-v3: stubs out crypto.subtle.digest's real (variable) native latency so the barrier check below is deterministic instead of racing an unbounded delay -- a slow digest/CI worker could otherwise let an unserialized "second" pass the barrier late and produce a false-pass.
    const digestSpy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockImplementation(() => Promise.resolve(new ArrayBuffer(32)));

    const originalExists = fake.apis.exists;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gateReleased = false;
    // QNBS-v3: a violation is recorded the instant it happens, not inferred from the absence of evidence after a fixed wait -- correct regardless of how long "second" takes to reach this point.
    let violation = false;
    fake.apis.exists = async (p: string) => {
      if (p === '/app/images/second.png' && !gateReleased) {
        violation = true;
      }
      if (p === '/app/images/first.png') {
        await gate;
      }
      return originalExists(p);
    };

    const firstPromise = store.getImage('first', 'proj-1');
    const secondPromise = store.getImage('second', 'proj-1');
    setTimeout(() => {
      gateReleased = true;
      releaseGate();
    }, 20);

    try {
      const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
      expect(violation).toBe(false);
      expect(firstResult).toBe('data:image/png;base64,FIRST');
      expect(secondResult).toBe('data:image/png;base64,SECOND');
    } finally {
      fake.apis.exists = originalExists;
      digestSpy.mockRestore();
    }
  });

  it('round-trips a binder binary asset with metadata', async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await store.saveBinderAsset('p1', 'a1', data, {
      name: 'doc.pdf',
      mime: 'application/pdf',
    } as never);
    const got = await store.getBinderAsset('p1', 'a1');
    expect(got?.meta.byteSize).toBe(4);
    expect(new Uint8Array(got?.data as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect(await store.listBinderAssetIds('p1')).toContain('a1');
    await store.deleteBinderAsset('p1', 'a1');
    expect(await store.getBinderAsset('p1', 'a1')).toBeNull();
  });

  it('returns null/[] for missing binder assets', async () => {
    expect(await store.getBinderAsset('p1', 'missing')).toBeNull();
    expect(await store.listBinderAssetIds('p1')).toEqual([]);
  });

  // QNBS-v3 (CodeAnt #363): simulates a torn write (a partially-applied metadata update from a different generation) and asserts the read side refuses to pair mismatched binary/metadata.
  it('treats a binary/metadata byteSize mismatch as corrupt rather than returning a mixed pair', async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await store.saveBinderAsset('p1', 'a1', data, {
      name: 'doc.pdf',
      mime: 'application/pdf',
    } as never);

    const metaFile = '/app/projects/p1/binder/a1.meta.json';
    const staleMeta = JSON.parse(fake.text.get(metaFile) as string);
    fake.text.set(metaFile, JSON.stringify({ ...staleMeta, byteSize: 999 }));

    expect(await store.getBinderAsset('p1', 'a1')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'getBinderAsset: byteSize/binary mismatch — treating pair as corrupt',
      expect.objectContaining({ expected: 999, actual: 4 }),
    );
  });

  // QNBS-v3: getQualifiedImage exists specifically so a rollback snapshot can't be handed a differently-provenanced legacy blob in place of "the qualified slot is genuinely empty".
  describe('getQualifiedImage / deleteQualifiedImage — rollback/transaction primitives', () => {
    it('reports absent (not the legacy blob) when only a legacy-flat image exists', async () => {
      fake.text.set('/app/images/legacy-only.png', 'data:image/png;base64,OLD');

      expect(await store.getQualifiedImage('legacy-only', 'proj-1')).toBeNull();
      // QNBS-v3: the merged-semantics getImage would return the legacy blob for the same call -- proves the two reads genuinely disagree, not just that getQualifiedImage happens to return null.
      expect(await store.getImage('legacy-only', 'proj-1')).toBe('data:image/png;base64,OLD');
    });

    it('does not claim legacy ownership merely by peeking at the qualified slot', async () => {
      fake.text.set('/app/images/solo.png', 'data:image/png;base64,SOLO');

      expect(await store.getQualifiedImage('solo', 'proj-1')).toBeNull();
      expect(fake.text.has('/app/images/.legacy-owner')).toBe(false);
    });

    it('returns the qualified value when present, ignoring an unrelated legacy file', async () => {
      fake.text.set('/app/images/dual.png', 'data:image/png;base64,LEGACYCOPY');
      await store.saveImage('dual', 'data:image/png;base64,QUALIFIED', 'proj-1');

      expect(await store.getQualifiedImage('dual', 'proj-1')).toBe(
        'data:image/png;base64,QUALIFIED',
      );
    });

    // QNBS-v3: shared assertion for "a qualified-only I/O failure propagates instead of being swallowed" -- the read and delete paths below share this exact shape: save an entity, fail one fake API call for its qualified path, assert the qualified-only call rejects, then always restore the original API.
    async function expectQualifiedIoFailurePropagates(
      entityId: string,
      errorMessage: string,
      install: (qualifiedPath: string) => () => void,
      run: (id: string) => Promise<unknown>,
    ) {
      await store.saveImage(entityId, 'data:image/png;base64,DATA', 'proj-1');
      const qualified = qualifiedImageKey(entityId);
      expect(qualified).toBeDefined();
      const restore = install(qualified as string);
      try {
        await expect(run(entityId)).rejects.toThrow(errorMessage);
      } finally {
        restore();
      }
    }

    it('propagates a read failure instead of collapsing it to null', async () => {
      await expectQualifiedIoFailurePropagates(
        'unreadable',
        'simulated decrypt failure',
        (qualified) => {
          const original = fake.apis.readTextFile;
          fake.apis.readTextFile = (p: string) =>
            p === qualified ? Promise.reject(new Error('simulated decrypt failure')) : original(p);
          return () => {
            fake.apis.readTextFile = original;
          };
        },
        (id) => store.getQualifiedImage(id, 'proj-1'),
      );
    });

    it('deletes only the qualified file, preserving an unrelated legacy copy', async () => {
      simulateLegacyImageOwner('proj-1');
      fake.text.set('/app/images/shared.png', 'data:image/png;base64,LEGACYCOPY');
      await store.saveImage('shared', 'data:image/png;base64,QUALIFIED', 'proj-1');

      await store.deleteQualifiedImage('shared', 'proj-1');

      expect(qualifiedImageKey('shared')).toBeUndefined();
      expect(fake.text.has('/app/images/shared.png')).toBe(true);
    });

    it('propagates a delete failure instead of swallowing it', async () => {
      await expectQualifiedIoFailurePropagates(
        'undeletable',
        'simulated I/O failure',
        (qualified) => {
          const original = fake.apis.remove;
          fake.apis.remove = (p: string) =>
            p === qualified ? Promise.reject(new Error('simulated I/O failure')) : original(p);
          return () => {
            fake.apis.remove = original;
          };
        },
        (id) => store.deleteQualifiedImage(id, 'proj-1'),
      );
    });

    it('is a no-op (not an error) when the qualified file never existed', async () => {
      await expect(store.deleteQualifiedImage('never-existed', 'proj-1')).resolves.toBeUndefined();
    });
  });
});

describe('FsProjectStore — export / import', () => {
  const exportable = {
    title: 'My Novel',
    logline: 'tale',
    characters: [
      {
        id: 'c1',
        name: 'Alice',
        backstory: 'b',
        personalityTraits: 'p',
        motivation: 'm',
        appearance: 'a',
      },
    ],
    worlds: [{ id: 'w1', name: 'Earth', description: 'd', geography: 'g', culture: 'c' }],
    manuscript: [{ id: 's1', title: 'Ch1', content: 'hello' }],
  };

  it('exports to JSON via the save dialog', async () => {
    fake.apis.save = () => Promise.resolve('/app/out.json');
    await store.exportProject(exportable as never, 'json');
    expect(fake.text.get('/app/out.json')).toContain('"title": "My Novel"');
  });

  it('exports to Markdown (characters + worlds sections)', async () => {
    fake.apis.save = () => Promise.resolve('/app/out.md');
    await store.exportProject(exportable as never, 'markdown');
    const md = fake.text.get('/app/out.md') ?? '';
    expect(md).toContain('# My Novel');
    expect(md).toContain('### Alice');
    expect(md).toContain('### Earth');
  });

  it('does nothing when the save dialog is cancelled', async () => {
    fake.apis.save = () => Promise.resolve(null);
    await store.exportProject(exportable as never, 'json');
    expect([...fake.text.keys()]).toHaveLength(0);
  });

  it('exports to a genuine DOCX (ZIP-signed) binary via writeFile, not text', async () => {
    fake.apis.save = () => Promise.resolve('/app/out.docx');
    await store.exportProject(exportable as never, 'docx');
    const written = fake.bin.get('/app/out.docx');
    expect(written).toBeDefined();
    // QNBS-v3 (DA-05): a .docx file is a ZIP container — its first 4 bytes are the ZIP local-file-header signature.
    expect(written?.subarray(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect([...fake.text.keys()]).toHaveLength(0);

    const zip = await import('jszip').then((m) => m.default.loadAsync(written as Uint8Array));
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).toContain('Logline');
    expect(documentXml).toContain('Manuscript');
  });

  it('returns null when the import dialog is cancelled', async () => {
    fake.apis.open = () => Promise.resolve(null);
    expect(await store.importProject()).toBeNull();
  });

  it('imports a Markdown project', async () => {
    const md =
      '---\ntitle: "Imported Tale"\nauthor: "Ann"\n---\n\n## Manuscript\nLine one\nLine two\n';
    fake.text.set('/app/import.md', md);
    fake.apis.open = () => Promise.resolve('/app/import.md');
    const project = await store.importProject();
    expect(project?.title).toBe('Imported Tale');
    expect(project?.manuscript?.[0]?.content).toContain('Line one');
  });

  it('imports a JSON project', async () => {
    const json = JSON.stringify({
      title: 'JSON Novel',
      logline: 'x',
      characters: [],
      worlds: [],
      outline: [],
      manuscript: [{ id: 's1', title: 'C', content: 'hi' }],
    });
    fake.text.set('/app/import.json', json);
    fake.apis.open = () => Promise.resolve('/app/import.json');
    const project = await store.importProject();
    expect(project?.title).toBe('JSON Novel');
  });
});
