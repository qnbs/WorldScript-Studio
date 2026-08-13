/**
 * Tests for the services/fs/ Tauri filesystem store chain
 * (FsProjectStore → FsAssetStore → FsSnapshotStore → FsCodexStore → FsSettingsStore → FsCore).
 * QNBS-v3 (Phase 2): an in-memory fake `TauriApis` drives real round-trips (compress, AES-GCM
 * key encryption, JSON) through the real store logic — only `loadTauriApis` is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';

// QNBS-v3: typed via `unknown` (not `any`) so the mock factories see a non-null TauriApis; the real value is set in beforeEach before any mock is invoked.
const { fsHolder } = vi.hoisted(() => ({ fsHolder: { current: null as unknown as TauriApis } }));

// QNBS-v3: controllable fake for storageEncryptionService's IDB-backed sentinel/session state — activeKey/sentinelConfigured drive resolveProtectedWriteKey()'s tri-state (real key | never configured | locked); idbEncryptWithKey/idbDecryptWithKey/IdbStorageLockedError are the REAL implementation via importOriginal (pure Web Crypto, no IDB access), so this file never needs to mock or initialize real IndexedDB.
const { cryptoState } = vi.hoisted(() => ({
  cryptoState: { activeKey: null as CryptoKey | null, sentinelConfigured: false },
}));
vi.mock('../../../../services/storage/storageEncryptionService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../services/storage/storageEncryptionService')>();
  return {
    ...actual,
    hasPassphraseSentinel: () => Promise.resolve(cryptoState.sentinelConfigured),
    resolveProtectedWriteKey: () => {
      if (cryptoState.activeKey) return Promise.resolve(cryptoState.activeKey);
      if (cryptoState.sentinelConfigured) return Promise.reject(new actual.IdbStorageLockedError());
      return Promise.resolve(null);
    },
  };
});

// QNBS-v3: mock the @tauri-apps plugin modules so the REAL loadTauriApis assembles a TauriApis whose methods delegate to the per-test in-memory fake FS (memoization-safe); exercises real store logic AND loadTauriApis itself.
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
  rename: (oldPath: string, newPath: string) => fsHolder.current.rename(oldPath, newPath),
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
import {
  IdbStorageLockedError,
  StorageEncryptionService,
} from '../../../../services/storage/storageEncryptionService';

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
    // QNBS-v3: atomic-write support (writeTextFileAtomic/writeFileAtomic) — a plain in-memory move from the temp key to the final key, mirroring a real filesystem rename.
    rename: (oldPath: string, newPath: string) => {
      if (text.has(oldPath)) {
        text.set(newPath, text.get(oldPath) as string);
        text.delete(oldPath);
      } else if (bin.has(oldPath)) {
        bin.set(newPath, bin.get(oldPath) as Uint8Array);
        bin.delete(oldPath);
      } else {
        return Promise.reject(new Error(`ENOENT ${oldPath}`));
      }
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
  cryptoState.activeKey = null;
  cryptoState.sentinelConfigured = false;
});
afterEach(() => {
  vi.clearAllMocks();
});

async function enableTestPassphrase(): Promise<void> {
  cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
    'test-passphrase',
    new Uint8Array(32).fill(7),
  );
  cryptoState.sentinelConfigured = true;
}

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

  // QNBS-v3 (2026-08-13): the actual fix under test — desktop project data previously ignored
  // the at-rest encryption setting entirely (README/docs corrected in a companion PR); it's now
  // real AES-GCM protection when a passphrase is configured and unlocked.
  it('encrypts project.json on disk when at-rest encryption is configured and unlocked, and still round-trips', async () => {
    await enableTestPassphrase();
    await store.saveProject(project as never);

    const onDisk = fake.text.get('/app/projects/p1/project.json') as string;
    expect(onDisk).not.toContain('My Novel');
    expect(JSON.parse(onDisk).scheme).toBe('protected-v1');

    expect((await store.loadProject('p1'))?.title).toBe('My Novel');
  });

  // QNBS-v3: a locked session is not "no project" — loadProject() must propagate IdbStorageLockedError so appBootstrap.ts's Promise.all surfaces it to index.tsx's unlock-modal-and-retry catch, instead of silently hydrating as a brand-new user.
  it('throws IdbStorageLockedError (not null) when loading a project while the session is locked', async () => {
    await enableTestPassphrase();
    await store.saveProject(project as never);
    cryptoState.activeKey = null; // simulate session lock; sentinelConfigured stays true

    await expect(store.loadProject('p1')).rejects.toBeInstanceOf(IdbStorageLockedError);
  });

  it('leaves project.json as plaintext when no at-rest passphrase is configured (unchanged default)', async () => {
    await store.saveProject(project as never);
    const onDisk = fake.text.get('/app/projects/p1/project.json') as string;
    expect(onDisk).toContain('My Novel');
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

  // QNBS-v3: empirical proof rename() replaces an existing project.json — a normal repeat save must succeed and reflect the new content.
  it('saves the same project twice, with the second save replacing the first', async () => {
    await store.saveProject(project as never);
    expect((await store.loadProject('p1'))?.title).toBe('My Novel');

    const updated = { ...project, title: 'Revised Novel' };
    await store.saveProject(updated as never);
    expect((await store.loadProject('p1'))?.title).toBe('Revised Novel');
  });

  // QNBS-v3: writeTextFileAtomic integration proof for the highest-stakes writer — an interrupted save (rename fails after the temp file has the new content) must never corrupt/truncate the previously-saved project.json.
  it('leaves the previously-saved project.json intact when an interrupted save fails after the temp write', async () => {
    await store.saveProject(project as never);
    expect((await store.loadProject('p1'))?.title).toBe('My Novel');

    fake.apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));
    const updated = { ...project, title: 'Renamed Novel' };
    await expect(store.saveProject(updated as never)).rejects.toThrow(/locked/);

    const reloaded = await store.loadProject('p1');
    expect(reloaded?.title).toBe('My Novel');
  });

  // QNBS-v3 (#332): a rejected marker write is a documented best-effort abort — it must not fail the project save that already succeeded.
  it('still resolves saveProject and logs a warning when the active-project marker write rejects', async () => {
    const originalWriteTextFile = fake.apis.writeTextFile;
    // QNBS-v3: writeTextFileAtomic writes to a temp sibling first — `.includes` (not `.endsWith`) still catches that path, failing before the rename step.
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

  it('encrypts settings.json on disk when at-rest encryption is configured, and still round-trips', async () => {
    await enableTestPassphrase();
    await store.saveSettings({ appearancePreset: 'sepia' } as never);

    const onDisk = fake.text.get('/app/config/settings.json') as string;
    expect(onDisk).not.toContain('sepia');
    expect(JSON.parse(onDisk).scheme).toBe('protected-v1');

    expect((await store.loadSettings())?.appearancePreset).toBe('sepia');
  });

  // QNBS-v3: a locked session is not "no settings" — loadSettings() must propagate IdbStorageLockedError so appBootstrap.ts's Promise.all surfaces it to index.tsx's unlock-modal-and-retry catch, instead of silently hydrating defaults.
  it('throws IdbStorageLockedError (not null) when loading settings while the session is locked', async () => {
    await enableTestPassphrase();
    await store.saveSettings({ appearancePreset: 'sepia' } as never);
    cryptoState.activeKey = null; // simulate session lock; sentinelConfigured stays true

    await expect(store.loadSettings()).rejects.toBeInstanceOf(IdbStorageLockedError);
  });

  // QNBS-v3 (2026-08-13, F-05/F-06 follow-up): no passphrase configured — honest plaintext, not a fake-secret derivation.
  it('round-trips an API key as plaintext when no at-rest passphrase is configured', async () => {
    await store.saveApiKey('openai', 'sk-secret-123');
    const stored = JSON.parse(fake.text.get('/app/config/openai_key.enc.json') as string);
    expect(stored.scheme).toBe('plaintext-v1');
    expect(await store.getApiKey('openai')).toBe('sk-secret-123');
    await store.clearApiKey('openai');
    expect(await store.getApiKey('openai')).toBeNull();
  });

  // QNBS-v3: a real, non-public secret protects the key when the user has configured and unlocked at-rest encryption.
  it('round-trips an API key under real AES-GCM protection when a passphrase is configured and unlocked', async () => {
    cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
      'test-passphrase',
      new Uint8Array(32).fill(7),
    );
    cryptoState.sentinelConfigured = true;

    await store.saveApiKey('openai', 'sk-secret-123');
    const stored = JSON.parse(fake.text.get('/app/config/openai_key.enc.json') as string);
    expect(stored.scheme).toBe('protected-v1');
    expect(stored.data).not.toContain('sk-secret-123');

    expect(await store.getApiKey('openai')).toBe('sk-secret-123');
  });

  // QNBS-v3: fail-closed, matching the existing IDB protected-write policy — never silently downgrade to plaintext while the user believes at-rest encryption is protecting this key.
  it('rejects saveApiKey when at-rest encryption is configured but the session is locked', async () => {
    cryptoState.sentinelConfigured = true; // configured, but no activeKey — locked

    await expect(store.saveApiKey('openai', 'sk-secret-123')).rejects.toThrow(/storage is locked/i);
    expect(fake.text.has('/app/config/openai_key.enc.json')).toBe(false);
  });

  // QNBS-v3: a locked-but-configured read must fail closed WITHOUT discarding the file — the key is still there, just temporarily unreadable until the user unlocks their session.
  it('returns null without discarding the file when reading a protected key while locked', async () => {
    cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
      'test-passphrase',
      new Uint8Array(32).fill(7),
    );
    cryptoState.sentinelConfigured = true;
    await store.saveApiKey('openai', 'sk-secret-123');

    cryptoState.activeKey = null; // simulate session lock; sentinelConfigured stays true

    expect(await store.getApiKey('openai')).toBeNull();
    expect(fake.text.has('/app/config/openai_key.enc.json')).toBe(true);
  });

  // QNBS-v3: critical fix — a passphrase rotation (active key no longer matching what a protected-v1 file was encrypted under) must NEVER discard the file; previously any non-locked decrypt failure fell into the generic discard path and would have permanently deleted a still-valid key.
  it('preserves a protected-v1 file that fails to decrypt under a different (rotated) key, instead of discarding it', async () => {
    cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
      'old-passphrase',
      new Uint8Array(32).fill(7),
    );
    cryptoState.sentinelConfigured = true;
    await store.saveApiKey('openai', 'sk-secret-123');

    // Simulate a completed passphrase rotation: a different active key, same salt.
    cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
      'new-passphrase',
      new Uint8Array(32).fill(7),
    );

    expect(await store.getApiKey('openai')).toBeNull();
    // The file must still be there — not silently deleted.
    expect(fake.text.has('/app/config/openai_key.enc.json')).toBe(true);
  });

  // QNBS-v3: provider-identity binding — a ciphertext swapped between two providers' files decrypts under the same key but fails the provider check, so it's rejected (and preserved), not silently handed to the wrong provider.
  it('rejects (without discarding) a protected-v1 file whose ciphertext belongs to a different provider', async () => {
    cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
      'test-passphrase',
      new Uint8Array(32).fill(7),
    );
    cryptoState.sentinelConfigured = true;
    await store.saveApiKey('openai', 'sk-openai-secret');
    await store.saveApiKey('anthropic', 'sk-anthropic-secret');

    // Swap the two providers' encrypted payloads on disk.
    const openaiContent = fake.text.get('/app/config/openai_key.enc.json') as string;
    const anthropicContent = fake.text.get('/app/config/anthropic_key.enc.json') as string;
    fake.text.set('/app/config/openai_key.enc.json', anthropicContent);
    fake.text.set('/app/config/anthropic_key.enc.json', openaiContent);

    expect(await store.getApiKey('openai')).toBeNull();
    expect(await store.getApiKey('anthropic')).toBeNull();
    // Neither file is discarded — the ciphertext is intact, just bound to the wrong provider.
    expect(fake.text.has('/app/config/openai_key.enc.json')).toBe(true);
    expect(fake.text.has('/app/config/anthropic_key.enc.json')).toBe(true);
  });

  it('delegates the Gemini key helpers to provider storage', async () => {
    await store.saveGeminiApiKey('gem-key');
    expect(await store.getGeminiApiKey()).toBe('gem-key');
  });

  it('rejects an empty API key', async () => {
    await expect(store.saveApiKey('openai', '  ')).rejects.toThrow(/empty/);
  });

  it('returns null when decrypting a missing key', async () => {
    expect(await store.getApiKey('anthropic')).toBeNull();
  });

  // QNBS-v3 (F-05/F-06 fix, 2026-07-29; superseded 2026-08-13): a pre-2026-07-29 key file
  // (unsalted single-SHA-256 scheme) is discarded, not migrated (locked decision) — this asserts
  // the discard path returns null without throwing, removes the stale file, and surfaces a
  // one-time notification rather than failing silently.
  it('discards a legacy unsalted key file, removes it, and notifies instead of throwing', async () => {
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
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'info',
            title: expect.stringContaining('API Key Reset'),
          }),
        }),
      );
    } finally {
      appStoreRef.current = null;
    }
  });

  // QNBS-v3 (2026-08-13): the 2026-07-29 fix (salted PBKDF2) is now ALSO obsolete — its passphrase
  // was `${appDataPath}|${provider}|WorldScriptStudio|v1`, entirely public — so a key file in that
  // format must be discarded exactly like the older unsalted one, not trusted as "already secure".
  it('discards a legacy salted-but-public-passphrase key file (2026-07-29 scheme), removes it, and notifies', async () => {
    const dispatch = vi.fn();
    appStoreRef.current = { getState: vi.fn(), dispatch } as never;
    try {
      const legacyFile = '/app/config/legacyprovider3_key.enc.json';
      fake.text.set(
        legacyFile,
        JSON.stringify({
          iv: 'AAAAAAAAAAAAAAAA',
          salt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          data: 'AAAAAAAAAAAAAAAA',
        }),
      );

      const result = await store.getApiKey('legacyprovider3');

      expect(result).toBeNull();
      expect(fake.text.has(legacyFile)).toBe(false);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'info',
            title: expect.stringContaining('API Key Reset'),
          }),
        }),
      );
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

  // QNBS-v3: value-level protection, not file-level — only the `data` field is protected so
  // listSnapshots() (name/date/wordCount) never needs to decrypt just to render a list.
  it('protects only the data field when at-rest encryption is configured, keeping name/date/wordCount plaintext and listable', async () => {
    await enableTestPassphrase();
    const id = await store.saveSnapshot('My Snapshot', {
      manuscript: [{ content: 'secret prose' }],
    });

    const onDiskFile = [...fake.text.keys()].find((k) => k.endsWith(`${id}.json`)) as string;
    const onDisk = JSON.parse(fake.text.get(onDiskFile) as string);
    expect(onDisk.name).toBe('My Snapshot'); // metadata stays plaintext
    expect(onDisk.data).not.toContain('secret prose'); // content is protected
    expect(JSON.parse(onDisk.data).scheme).toBe('protected-v1');

    // Listing must not require a passphrase/key at all — lock the session and confirm it still works.
    cryptoState.activeKey = null;
    const list = await store.listSnapshots();
    expect(list.find((s) => s.id === id)?.name).toBe('My Snapshot');

    // Reading the actual content still requires (and correctly uses) the key once unlocked again.
    await enableTestPassphrase();
    expect(await store.getSnapshotData(id)).toEqual({ manuscript: [{ content: 'secret prose' }] });
  });

  // QNBS-v3: a locked session is not "no snapshot" — getSnapshotData() must propagate IdbStorageLockedError, not swallow it.
  it('throws IdbStorageLockedError (not null) when reading a protected snapshot while the session is locked', async () => {
    await enableTestPassphrase();
    const id = await store.saveSnapshot('My Snapshot', { manuscript: [] });
    cryptoState.activeKey = null; // simulate session lock; sentinelConfigured stays true

    await expect(store.getSnapshotData(id)).rejects.toBeInstanceOf(IdbStorageLockedError);
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

  it('encrypts codex.snap and vectors.snap on disk when at-rest encryption is configured, and still round-trips', async () => {
    await enableTestPassphrase();
    await store.saveStoryCodex({ projectId: 'p1', entries: [{ k: 'secret-entity' }] } as never);
    await store.saveRagVectors('p1', [{ id: 1 }]);

    const codexOnDisk = fake.text.get('/app/projects/p1/codex/codex.snap') as string;
    const vectorsOnDisk = fake.text.get('/app/projects/p1/codex/vectors.snap') as string;
    expect(codexOnDisk).not.toContain('secret-entity');
    expect(JSON.parse(codexOnDisk).scheme).toBe('protected-v1');
    expect(JSON.parse(vectorsOnDisk).scheme).toBe('protected-v1');

    expect((await store.getStoryCodex('p1')) as { entries?: unknown[] } | null).toEqual(
      expect.objectContaining({ entries: [{ k: 'secret-entity' }] }),
    );
    expect(await store.getRagVectors('p1')).toEqual([{ id: 1 }]);
  });

  // QNBS-v3: a locked session is not "no codex/vectors" — both getters must propagate IdbStorageLockedError, not swallow it.
  it('throws IdbStorageLockedError (not null/[]) when reading protected codex/RAG data while the session is locked', async () => {
    await enableTestPassphrase();
    await store.saveStoryCodex({ projectId: 'p1', entries: [] } as never);
    await store.saveRagVectors('p1', [{ id: 1 }]);
    cryptoState.activeKey = null; // simulate session lock; sentinelConfigured stays true

    await expect(store.getStoryCodex('p1')).rejects.toBeInstanceOf(IdbStorageLockedError);
    await expect(store.getRagVectors('p1')).rejects.toBeInstanceOf(IdbStorageLockedError);
  });
});

describe('FsAssetStore — images + binder assets', () => {
  it('round-trips an image (strips/re-adds the data-url prefix)', async () => {
    await store.saveImage('char-1', 'data:image/png;base64,QUJD');
    expect(await store.getImage('char-1')).toBe('data:image/png;base64,QUJD');
    await store.deleteImage('char-1');
    expect(await store.getImage('char-1')).toBeNull();
  });

  it('encrypts an image on disk when at-rest encryption is configured, and still round-trips', async () => {
    await enableTestPassphrase();
    await store.saveImage('char-1', 'data:image/png;base64,QUJD');

    const onDisk = fake.text.get('/app/images/char-1.png') as string;
    expect(onDisk).not.toContain('QUJD');
    expect(JSON.parse(onDisk).scheme).toBe('protected-v1');

    expect(await store.getImage('char-1')).toBe('data:image/png;base64,QUJD');
  });

  // QNBS-v3: a locked session is not "no image" — getImage() must propagate IdbStorageLockedError, not swallow it.
  it('throws IdbStorageLockedError (not null) when reading a protected image while the session is locked', async () => {
    await enableTestPassphrase();
    await store.saveImage('char-1', 'data:image/png;base64,QUJD');
    cryptoState.activeKey = null; // simulate session lock; sentinelConfigured stays true

    await expect(store.getImage('char-1')).rejects.toBeInstanceOf(IdbStorageLockedError);
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
