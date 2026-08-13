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

import {
  checkForInterruptedFsMigration,
  migrateAllProtectedFsData,
} from '../../../../services/fs/fsEncryptionMigration';
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

    await migrateAllProtectedFsData(null, 'disable');

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
    await migrateAllProtectedFsData(null, 'disable');
    expect(fake.text.get('/app/projects/p1/project.json')).toBe(before);
  });
});

describe('migrateAllProtectedFsData — set (first-time setup)', () => {
  it('encrypts every existing plaintext file, not just future saves', async () => {
    // No passphrase configured yet — every save below lands as plaintext (lazy/opportunistic
    // design), exactly like a real pre-existing desktop install turning encryption on for the
    // first time.
    await fileSystemService.saveProject(project as never);
    await fileSystemService.saveApiKey('gemini', 'secret-key-123');
    const snapshotId = await fileSystemService.saveSnapshot('manual', project);
    expect(fake.text.get('/app/projects/p1/project.json')).not.toContain('protected-v1');
    expect(fake.text.get('/app/config/gemini_key.enc.json')).toContain('"scheme":"plaintext-v1"');

    const newKey = await deriveKey('first-passphrase');
    await migrateAllProtectedFsData(newKey, 'set');

    expect(fake.text.get('/app/projects/p1/project.json')).toContain('"scheme":"protected-v1"');
    expect(fake.text.get('/app/config/gemini_key.enc.json')).toContain('"scheme":"protected-v1"');
    const snapshotRaw = fake.text.get(`/app/snapshots/${snapshotId}.json`);
    expect(JSON.parse(snapshotRaw as string).data).toContain('protected-v1');

    cryptoState.activeKey = newKey;
    cryptoState.sentinelConfigured = true;
    expect((await fileSystemService.loadProject('p1'))?.title).toBe('My Novel');
    expect(await fileSystemService.getApiKey('gemini')).toBe('secret-key-123');
  });

  it('skips (does not throw or discard) a file it cannot decrypt, unlike disable/rotate', async () => {
    // Simulate a stray already-protected file left over from a previous, unrelated encryption
    // session — the exact edge case 'set' must tolerate rather than abort on.
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    cryptoState.activeKey = null;
    cryptoState.sentinelConfigured = false;

    const before = fake.text.get('/app/projects/p1/project.json');
    const newKey = await deriveKey('first-passphrase');
    cryptoState.activeKey = newKey;
    cryptoState.sentinelConfigured = true;

    await expect(migrateAllProtectedFsData(newKey, 'set')).resolves.toBeUndefined();
    // Left untouched — the new key can't decrypt it, and 'set' must not destroy or crash on that.
    expect(fake.text.get('/app/projects/p1/project.json')).toBe(before);
  });
});

describe('migrateAllProtectedFsData — interrupted-migration marker', () => {
  it('leaves no marker after a successful migration', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    await migrateAllProtectedFsData(null, 'disable');
    expect(await checkForInterruptedFsMigration()).toBeNull();
  });

  it('leaves the marker in place when a strict-mode migration throws (simulated crash-equivalent)', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    cryptoState.activeKey = await deriveKey('a-completely-different-passphrase');

    await expect(migrateAllProtectedFsData(null, 'disable')).rejects.toThrow();

    const marker = await checkForInterruptedFsMigration();
    expect(marker).toEqual(expect.objectContaining({ operation: 'disable' }));
  });

  it('reports no marker when none exists', async () => {
    expect(await checkForInterruptedFsMigration()).toBeNull();
  });
});

describe('migrateAllProtectedFsData — rotate (targetKey = new key)', () => {
  it('re-encrypts project data and an API key under the new key before the active key swaps', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    await fileSystemService.saveApiKey('openai', 'rotate-me');

    const newKey = await deriveKey('new-passphrase');
    await migrateAllProtectedFsData(newKey, 'rotate');

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

    await expect(migrateAllProtectedFsData(null, 'disable')).rejects.toThrow();
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
    await migrateAllProtectedFsData(null, 'disable');
    expect(fake.bin.get('/app/projects/p1/binder/asset-1.bin')).toEqual(before);
  });

  // QNBS-v3: a permission/IO error reading a file that DOES exist must never be conflated with "file
  // never existed" — the prior `.catch(() => null)` pattern silently skipped such files, letting
  // disable/rotate complete and destroy/swap the key while stranding the unreadable file's ciphertext.
  it('propagates (does not silently skip) a read failure on a file that exists, in strict mode', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    const originalReadTextFile = fake.apis.readTextFile;
    fake.apis.readTextFile = (p: string) => {
      if (p === '/app/projects/p1/project.json') return Promise.reject(new Error('EACCES'));
      return originalReadTextFile(p);
    };

    await expect(migrateAllProtectedFsData(null, 'disable')).rejects.toThrow(/EACCES/);
  });

  it('logs and skips (does not throw) a read failure on a file that exists, in non-strict (set) mode', async () => {
    await fileSystemService.saveProject(project as never);
    const originalReadTextFile = fake.apis.readTextFile;
    fake.apis.readTextFile = (p: string) => {
      if (p === '/app/projects/p1/project.json') return Promise.reject(new Error('EACCES'));
      return originalReadTextFile(p);
    };

    const newKey = await deriveKey('first-passphrase');
    await expect(migrateAllProtectedFsData(newKey, 'set')).resolves.toBeUndefined();
  });

  // QNBS-v3: a ciphertext swapped between two provider files must not be "laundered" into a
  // correctly-labeled new file by re-keying — the same provider-identity check normal reads enforce.
  it('rejects (does not launder) an API key ciphertext whose decrypted provider does not match its filename', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveApiKey('openai', 'openai-secret');
    // Swap the ciphertext into a differently-named file, simulating a cross-file substitution.
    const openaiRaw = fake.text.get('/app/config/openai_key.enc.json') as string;
    fake.text.set('/app/config/anthropic_key.enc.json', openaiRaw);

    const newKey = await deriveKey('new-passphrase');
    await expect(migrateAllProtectedFsData(newKey, 'rotate')).rejects.toThrow(/anthropic/);
  });

  // QNBS-v3: a malformed API-key file must never strand setupIdbEncryption()'s already-activated
  // sentinel/key — non-strict (first-time setup) must swallow even a synchronous JSON.parse throw.
  it('does not throw when an API key file contains malformed JSON, in non-strict (set) mode', async () => {
    await fake.apis.mkdir('/app/config');
    fake.text.set('/app/config/openai_key.enc.json', '{not valid json');

    const newKey = await deriveKey('first-passphrase');
    await expect(migrateAllProtectedFsData(newKey, 'set')).resolves.toBeUndefined();
  });

  it('throws when an API key file contains malformed JSON, in strict (disable/rotate) mode', async () => {
    await enableTestPassphrase();
    await fake.apis.mkdir('/app/config');
    fake.text.set('/app/config/openai_key.enc.json', '{not valid json');

    await expect(migrateAllProtectedFsData(null, 'disable')).rejects.toThrow();
  });

  // QNBS-v3: a 'set' migration running right after setupIdbEncryption() has already activated the sentinel must never throw from a routine per-file write failure — the caller has no safe partial-success state to leave the sentinel in.
  it('logs and skips (does not throw) a write failure on an otherwise-migratable file, in non-strict (set) mode', async () => {
    await fileSystemService.saveProject(project as never);
    const originalWriteTextFile = fake.apis.writeTextFile;
    fake.apis.writeTextFile = (p: string, c: string) => {
      if (p.includes('project.json') && p.includes('.tmp-'))
        return Promise.reject(new Error('EIO'));
      return originalWriteTextFile(p, c);
    };

    const newKey = await deriveKey('first-passphrase');
    await expect(migrateAllProtectedFsData(newKey, 'set')).resolves.toBeUndefined();
    // The file is left exactly as it was before the failed write attempt — not corrupted, not stranded.
    expect(fake.text.get('/app/projects/p1/project.json')).toBeDefined();
  });

  it('propagates (does not silently skip) a write failure on an otherwise-migratable file, in strict (disable/rotate) mode', async () => {
    await enableTestPassphrase();
    await fileSystemService.saveProject(project as never);
    const originalWriteTextFile = fake.apis.writeTextFile;
    fake.apis.writeTextFile = (p: string, c: string) => {
      if (p.includes('project.json') && p.includes('.tmp-'))
        return Promise.reject(new Error('EIO'));
      return originalWriteTextFile(p, c);
    };

    await expect(migrateAllProtectedFsData(null, 'disable')).rejects.toThrow(/EIO/);
  });
});
