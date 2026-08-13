/**
 * Tests for services/fs/fsEncryptionMigration.ts — the desktop fs-backed protected-data migration
 * bridge that must run BEFORE storageEncryptionService's clearIdbPassphrase()/rotateIdbPassphrase()
 * swap or discard the active session key, or fs-backed project data / API keys would be stranded
 * under a now-unrecoverable key. Same in-memory fake-Tauri scaffolding as fsStores.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';

const { fsHolder } = vi.hoisted(() => ({ fsHolder: { current: null as unknown as TauriApis } }));

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

import { migrateAllProtectedFsData } from '../../../../services/fs/fsEncryptionMigration';
import { fileSystemService } from '../../../../services/fs/index';
import { StorageEncryptionService } from '../../../../services/storage/storageEncryptionService';

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

let fake: FakeFs;

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  return new StorageEncryptionService().deriveKey(passphrase, new Uint8Array(32).fill(7));
}

async function enableTestPassphrase(): Promise<void> {
  cryptoState.activeKey = await deriveKey('old-passphrase');
  cryptoState.sentinelConfigured = true;
}

beforeEach(() => {
  fake = makeFakeFs();
  fsHolder.current = fake.apis;
  cryptoState.activeKey = null;
  cryptoState.sentinelConfigured = false;
});
afterEach(() => {
  vi.clearAllMocks();
});

const project = {
  id: 'p1',
  title: 'My Novel',
  logline: 'A tale',
  manuscript: [{ id: 's1', title: 'Ch1', content: 'hello world' }],
  characters: [],
  worlds: [],
  outline: [],
};

describe('migrateAllProtectedFsData — disable (targetKey = null)', () => {
  it('converts project.json, settings.json, an API key, a snapshot, and codex data to plaintext', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    await fileSystemService.saveSettings({ language: 'en' } as never);
    await fileSystemService.saveApiKey('gemini', 'secret-key-123');
    const snapshotId = await fileSystemService.saveSnapshot('manual', project);
    await fileSystemService.saveStoryCodex({ projectId: 'p1' } as never);
    await fileSystemService.saveImage('char-1', 'data:image/png;base64,QUJD');

    // Sanity: raw bytes on disk are actually wrapped as protected-v1 before migration.
    expect(fake.text.get('/app/projects/p1/project.json')).toContain('"scheme":"protected-v1"');
    expect(fake.text.get('/app/config/gemini_key.enc.json')).toContain('"scheme":"protected-v1"');

    await migrateAllProtectedFsData(null);

    expect(fake.text.get('/app/projects/p1/project.json')).not.toContain('protected-v1');
    expect(fake.text.get('/app/config/settings.json')).not.toContain('protected-v1');
    expect(fake.text.get('/app/config/gemini_key.enc.json')).toContain('"scheme":"plaintext-v1"');
    expect(fake.text.get('/app/projects/p1/codex/codex.snap')).not.toContain('protected-v1');
    expect(fake.text.get('/app/images/char-1.png')).not.toContain('protected-v1');

    const snapshotRaw = fake.text.get(`/app/snapshots/${snapshotId}.json`);
    expect(snapshotRaw).toBeDefined();
    expect(JSON.parse(snapshotRaw as string).data).not.toContain('protected-v1');

    // Now that the sentinel is gone (simulating clearIdbPassphrase() running next), reads must
    // still succeed without a key — proving the data is genuinely plaintext, not just re-labeled.
    cryptoState.activeKey = null;
    cryptoState.sentinelConfigured = false;
    expect((await fileSystemService.loadProject('p1'))?.title).toBe('My Novel');
    expect(await fileSystemService.getApiKey('gemini')).toBe('secret-key-123');
    expect(await fileSystemService.getSnapshotData(snapshotId)).toEqual(project);
    expect(await fileSystemService.getImage('char-1')).toContain('QUJD');
  });

  it('leaves an already-plaintext project untouched (no key ever configured)', async () => {
    await fileSystemService.saveProject(project as never);
    const before = fake.text.get('/app/projects/p1/project.json');
    await migrateAllProtectedFsData(null);
    expect(fake.text.get('/app/projects/p1/project.json')).toBe(before);
  });
});

describe('migrateAllProtectedFsData — rotate (targetKey = new key)', () => {
  it('re-encrypts project data and an API key under the new key before the active key swaps', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    await fileSystemService.saveApiKey('openai', 'rotate-me');

    const newKey = await deriveKey('new-passphrase');
    await migrateAllProtectedFsData(newKey);

    // Old key can no longer decrypt the on-disk bytes — proves re-encryption actually happened.
    cryptoState.activeKey = await deriveKey('old-passphrase');
    await expect(fileSystemService.loadProject('p1')).resolves.toBeNull();

    // New key (simulating rotateIdbPassphrase() having swapped the active session) reads fine.
    cryptoState.activeKey = newKey;
    expect((await fileSystemService.loadProject('p1'))?.title).toBe('My Novel');
    expect(await fileSystemService.getApiKey('openai')).toBe('rotate-me');
  });
});

describe('migrateAllProtectedFsData — safety', () => {
  it('throws and leaves data untouched when a protected file cannot be decrypted under the current key', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);

    // Simulate a corrupted/mismatched-key file: the session reports a key, but it's not the one
    // the file was actually encrypted under.
    cryptoState.activeKey = await deriveKey('a-completely-different-passphrase');

    await expect(migrateAllProtectedFsData(null)).rejects.toThrow();
  });

  it('does not touch binder assets, which are intentionally out of scope', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveBinderAsset(
      'p1',
      'asset-1',
      new TextEncoder().encode('raw bytes').buffer,
      { originalFileName: 'note.txt', mimeType: 'text/plain', byteSize: 0 },
    );
    const before = fake.bin.get('/app/projects/p1/binder/asset-1.bin');
    await migrateAllProtectedFsData(null);
    expect(fake.bin.get('/app/projects/p1/binder/asset-1.bin')).toEqual(before);
  });
});
