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
        writeTextFile: (p: string, c: string) => fsHolder.current.writeTextFile(p, c),
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
    const originalRename = fake.apis.rename;
    let firstTarget: string | undefined;
    let racePending = true;
    fake.apis.rename = (from: string, to: string) => {
      if (racePending) {
        racePending = false;
        firstTarget = to;
        return fake.apis.mkdir(to).then(() => originalRename(from, to));
      }
      return originalRename(from, to);
    };

    const result = await store.quarantineProject('p1');

    expect(firstTarget).toBeDefined();
    expect(result.path).not.toBe(firstTarget);
    expect(fake.text.get(`${result.path}/project.json`)).toBeDefined();
    expect(fake.text.has('/app/projects/p1/project.json')).toBe(false);
  });

  // QNBS-v3: report source disappearance as concurrent preservation, without inventing a quarantine path.
  it('reports when another recovery moved the source before this rename', async () => {
    await store.saveProject(project as never);
    fake.apis.rename = async (from: string) => {
      await fake.apis.remove(from);
      throw new Error(`ENOENT ${from}`);
    };

    await expect(store.quarantineProject('p1')).rejects.toMatchObject({
      name: 'ProjectQuarantineError',
      reason: 'already-preserved',
    });
    expect(await store.listProjects()).not.toContain('p1');
  });

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
    await store.saveImage('char-1', 'data:image/webp;base64,QUJD');
    expect(await store.getImage('char-1')).toBe('data:image/webp;base64,QUJD');
    await store.deleteImage('char-1');
    expect(await store.getImage('char-1')).toBeNull();
  });

  it('treats legacy raw image payloads as PNG', async () => {
    await store.saveImage('legacy-char', 'QUJD');
    expect(await store.getImage('legacy-char')).toBe('data:image/png;base64,QUJD');
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
