/**
 * Tests for the services/fs/ Tauri filesystem store chain
 * (FsProjectStore → FsAssetStore → FsSnapshotStore → FsCodexStore → FsSettingsStore → FsCore).
 * QNBS-v3 (Phase 2): an in-memory fake `TauriApis` drives real round-trips (compress, AES-GCM
 * key encryption, JSON) through the real store logic — only `loadTauriApis` is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';

// QNBS-v3: typed via `unknown` (not `any`) so the mock factories see a non-null TauriApis; the
// real value is set in beforeEach before any mock is invoked.
const { fsHolder } = vi.hoisted(() => ({ fsHolder: { current: null as unknown as TauriApis } }));

// QNBS-v3: mock the @tauri-apps plugin modules so the REAL loadTauriApis assembles a TauriApis
// whose methods delegate to the per-test in-memory fake FS (memoization-safe — each call reads
// fsHolder.current). This exercises the real store logic AND loadTauriApis itself.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => fsHolder.current.invoke(cmd, args),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (p: string) => fsHolder.current.readTextFile(p),
  writeTextFile: (p: string, c: string) => fsHolder.current.writeTextFile(p, c),
  readFile: (p: string) => fsHolder.current.readFile(p),
  writeFile: (p: string, d: Uint8Array) => fsHolder.current.writeFile(p, d),
  mkdir: (p: string, opts?: { recursive?: boolean }) => fsHolder.current.mkdir(p, opts),
  exists: (p: string) => fsHolder.current.exists(p),
  readDir: (p: string) => fsHolder.current.readDir(p),
  remove: (p: string, opts?: { recursive?: boolean }) => fsHolder.current.remove(p, opts),
  rename: (from: string, to: string) => fsHolder.current.rename(from, to),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (opts?: Record<string, unknown>) => fsHolder.current.open(opts),
  save: (opts?: Record<string, unknown>) => fsHolder.current.save(opts),
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: () => fsHolder.current.appDataDir(),
  join: (...parts: string[]) => fsHolder.current.join(...parts),
}));
vi.mock('../../../../services/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/logger')>();
  return { ...actual, logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
});

import { appStoreRef } from '../../../../app/storeRef';
import { FsProjectStore } from '../../../../services/fs/projectFsStore';
import { logger } from '../../../../services/logger';

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
    mkdir: (p: string) => {
      dirs.add(p);
      return Promise.resolve();
    },
    writeTextFile: (p: string, c: string) => {
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
    rename: (from: string, to: string) => {
      if (!text.has(from) && !bin.has(from)) return Promise.reject(new Error(`ENOENT ${from}`));
      text.delete(to);
      bin.delete(to);
      const textValue = text.get(from);
      const binaryValue = bin.get(from);
      if (textValue !== undefined) text.set(to, textValue);
      if (binaryValue !== undefined) bin.set(to, binaryValue);
      text.delete(from);
      bin.delete(from);
      return Promise.resolve();
    },
    readDir: (p: string) => Promise.resolve(under(p).map((name) => ({ name, isDirectory: false }))),
    open: () => Promise.resolve(null),
    save: () => Promise.resolve(null),
    invoke: () => Promise.resolve(undefined),
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

  it('returns null for a missing project and [] when no projects dir', async () => {
    expect(await store.loadProject('nope')).toBeNull();
    expect(await store.listProjects()).toEqual([]);
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
    ).rejects.toThrow('disk full');
    expect((await store.loadProject('p1'))?.title).toBe('My Novel');
    expect([...fake.text.keys()].some((path) => path.includes('.tmp-'))).toBe(false);
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
    await expect(store.saveApiKey('openai', 'sk-secret-123')).rejects.toThrow(/disabled/);
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

  // QNBS-v3: legacy filesystem key files are discarded because their derivation was recoverable.
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
  it('round-trips an image (strips/re-adds the data-url prefix)', async () => {
    await store.saveImage('char-1', 'data:image/png;base64,QUJD');
    expect(await store.getImage('char-1')).toBe('data:image/png;base64,QUJD');
    await store.deleteImage('char-1');
    expect(await store.getImage('char-1')).toBeNull();
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
