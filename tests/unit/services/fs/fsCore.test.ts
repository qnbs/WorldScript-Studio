/**
 * Tests for services/fs/fsCore.ts — the pure utilities shared by the Tauri FS stores.
 * QNBS-v3 (Phase 2): retry classification, compression round-trip, AES-GCM crypto, path
 * sanitization, and word counting — no Tauri APIs required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';
import {
  base64ToBytes,
  bytesToBase64,
  cleanupOrphanedTempFiles,
  compressData,
  countProjectWords,
  decompressData,
  protectTextValue,
  readProtectedTextFile,
  retryFs,
  sanitizePathSegment,
  unprotectTextValue,
  writeFileAtomic,
  writeProtectedTextFileAtomic,
  writeTextFileAtomic,
} from '../../../../services/fs/fsCore';

// QNBS-v3: controllable fake for storageEncryptionService's IDB-backed sentinel/session state — see tests/unit/services/fs/fsStores.test.ts for the full rationale (same pattern, scoped here to the pure protectTextValue/unprotectTextValue helpers rather than a whole store).
// QNBS-v3: keyResolutionDelaysMs lets a test make one call's resolveProtectedWriteKey() (the first async step inside protectTextValue) resolve slower than another's, to test write-ordering under encryption.
const { cryptoState } = vi.hoisted(() => ({
  cryptoState: {
    activeKey: null as CryptoKey | null,
    sentinelConfigured: false,
    keyResolutionDelaysMs: [] as number[],
  },
}));
vi.mock('../../../../services/storage/storageEncryptionService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../services/storage/storageEncryptionService')>();
  return {
    ...actual,
    hasPassphraseSentinel: () => Promise.resolve(cryptoState.sentinelConfigured),
    assertSecureStorageReadable: () => {
      if (cryptoState.sentinelConfigured && !cryptoState.activeKey) {
        return Promise.reject(new actual.IdbStorageLockedError());
      }
      return Promise.resolve(cryptoState.sentinelConfigured);
    },
    resolveProtectedWriteKey: async () => {
      const delay = cryptoState.keyResolutionDelaysMs.shift();
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (cryptoState.activeKey) return cryptoState.activeKey;
      if (cryptoState.sentinelConfigured) throw new actual.IdbStorageLockedError();
      return null;
    },
  };
});

import { withMigrationAdmission } from '../../../../services/storage/protectedWriteAdmission';
import {
  SecureRecordCorruptError,
  StorageEncryptionService,
} from '../../../../services/storage/storageEncryptionService';

beforeEach(() => {
  cryptoState.activeKey = null;
  cryptoState.sentinelConfigured = false;
  cryptoState.keyResolutionDelaysMs = [];
});

// QNBS-v3: entries are plain names, directories suffixed with '/' — just enough to model a nested tree for cleanupOrphanedTempFiles' recursive walk, independent of makeAtomicWriteFake above.
function makeDirTreeFake(tree: Record<string, string[]>) {
  const removed: string[] = [];
  const apis: Pick<TauriApis, 'readDir' | 'remove' | 'join'> = {
    readDir: (dir) => {
      const entries = tree[dir];
      if (!entries) return Promise.reject(new Error(`ENOENT ${dir}`));
      return Promise.resolve(
        entries.map((name) => ({
          name: name.endsWith('/') ? name.slice(0, -1) : name,
          isDirectory: name.endsWith('/'),
        })),
      );
    },
    remove: (p: string) => {
      removed.push(p);
      return Promise.resolve();
    },
    join: (...parts: string[]) => Promise.resolve(parts.join('/')),
  };
  return { apis: apis as TauriApis, removed };
}

// QNBS-v3: minimal in-memory fake covering only what writeTextFileAtomic/writeFileAtomic use — a lighter-weight sibling of fsStores.test.ts's fuller FakeFs, scoped to this file's needs.
function makeAtomicWriteFake() {
  const text = new Map<string, string>();
  const bin = new Map<string, Uint8Array>();
  const apis: Pick<
    TauriApis,
    'writeTextFile' | 'writeFile' | 'readTextFile' | 'rename' | 'remove'
  > = {
    writeTextFile: (p, c) => {
      text.set(p, c);
      return Promise.resolve();
    },
    writeFile: (p, d) => {
      bin.set(p, d);
      return Promise.resolve();
    },
    readTextFile: (p) => {
      if (!text.has(p)) return Promise.reject(new Error(`ENOENT ${p}`));
      return Promise.resolve(text.get(p) as string);
    },
    rename: (oldPath, newPath) => {
      if (text.has(oldPath)) {
        text.set(newPath, text.get(oldPath) as string);
        text.delete(oldPath);
      } else if (bin.has(oldPath)) {
        bin.set(newPath, bin.get(oldPath) as Uint8Array);
        bin.delete(oldPath);
      }
      return Promise.resolve();
    },
    remove: (p) => {
      text.delete(p);
      bin.delete(p);
      return Promise.resolve();
    },
  };
  return { apis: apis as TauriApis, text, bin };
}

async function enableTestPassphrase(): Promise<void> {
  cryptoState.activeKey = await new StorageEncryptionService().deriveKey(
    'test-passphrase',
    new Uint8Array(32).fill(7),
  );
  cryptoState.sentinelConfigured = true;
}

describe('retryFs', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryFs(fn, 2, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('resource temporarily unavailable'))
      .mockResolvedValueOnce('recovered');
    await expect(retryFs(fn, 2, 0)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permission denied'));
    await expect(retryFs(fn, 2, 0)).rejects.toThrow('permission denied');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting retries on persistent transient failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('file is locked, try again'));
    await expect(retryFs(fn, 2, 0)).rejects.toThrow(/locked/);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe('writeTextFileAtomic / writeFileAtomic', () => {
  it('writes content under the final path and leaves no temp file behind', async () => {
    const { apis, text } = makeAtomicWriteFake();
    await writeTextFileAtomic(apis, '/app/project.json', '{"a":1}');
    expect(text.get('/app/project.json')).toBe('{"a":1}');
    expect([...text.keys()]).toEqual(['/app/project.json']);
  });

  it('binary variant writes content under the final path and leaves no temp file behind', async () => {
    const { apis, bin } = makeAtomicWriteFake();
    const data = new Uint8Array([1, 2, 3]);
    await writeFileAtomic(apis, '/app/asset.bin', data);
    expect(bin.get('/app/asset.bin')).toEqual(data);
    expect([...bin.keys()]).toEqual(['/app/asset.bin']);
  });

  // QNBS-v3: the core crash-safety guarantee — a failure after the temp write but before rename must never touch the final path, so a reader always sees the old or new complete file, never a partial/torn write.
  it('leaves the original file untouched when the rename step fails after the temp write succeeds', async () => {
    const { apis, text } = makeAtomicWriteFake();
    text.set('/app/project.json', '{"old":true}');
    apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));

    await expect(writeTextFileAtomic(apis, '/app/project.json', '{"new":true}')).rejects.toThrow(
      /locked/,
    );
    expect(text.get('/app/project.json')).toBe('{"old":true}');
  });

  it('cleans up the orphaned temp file when the rename step fails', async () => {
    const { apis, text } = makeAtomicWriteFake();
    apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));
    const removeSpy = vi.spyOn(apis, 'remove');

    await expect(writeTextFileAtomic(apis, '/app/project.json', '{"new":true}')).rejects.toThrow(
      /locked/,
    );

    expect(removeSpy).toHaveBeenCalledWith(expect.stringContaining('/app/project.json.tmp-'));
    expect([...text.keys()]).toEqual([]);
  });

  it('leaves the original file untouched when the temp-file write itself fails', async () => {
    const { apis, text } = makeAtomicWriteFake();
    text.set('/app/project.json', '{"old":true}');
    apis.writeTextFile = () => Promise.reject(new Error('disk full'));

    await expect(writeTextFileAtomic(apis, '/app/project.json', '{"new":true}')).rejects.toThrow(
      /disk full/,
    );
    expect(text.get('/app/project.json')).toBe('{"old":true}');
  });

  it('does not throw when best-effort cleanup of the orphaned temp file also fails', async () => {
    const { apis } = makeAtomicWriteFake();
    apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));
    apis.remove = () => Promise.reject(new Error('ENOENT'));

    // The original rename error must still surface — the cleanup failure must not mask it or
    // throw an unhandled rejection of its own.
    await expect(writeTextFileAtomic(apis, '/app/project.json', '{"new":true}')).rejects.toThrow(
      /locked/,
    );
  });

  // QNBS-v3: binary-path parity with the text-path failure-mode tests above.
  it('binary: leaves the original file untouched when the rename step fails after the temp write succeeds', async () => {
    const { apis, bin } = makeAtomicWriteFake();
    const original = new Uint8Array([9, 9, 9]);
    bin.set('/app/asset.bin', original);
    apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));

    await expect(
      writeFileAtomic(apis, '/app/asset.bin', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/locked/);
    expect(bin.get('/app/asset.bin')).toEqual(original);
    expect([...bin.keys()]).toEqual(['/app/asset.bin']);
  });

  it('binary: cleans up the orphaned temp file when the rename step fails', async () => {
    const { apis, bin } = makeAtomicWriteFake();
    apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));
    const removeSpy = vi.spyOn(apis, 'remove');

    await expect(
      writeFileAtomic(apis, '/app/asset.bin', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/locked/);

    expect(removeSpy).toHaveBeenCalledWith(expect.stringContaining('/app/asset.bin.tmp-'));
    expect([...bin.keys()]).toEqual([]);
  });

  it('binary: leaves the original file untouched when the temp-file write itself fails', async () => {
    const { apis, bin } = makeAtomicWriteFake();
    const original = new Uint8Array([9, 9, 9]);
    bin.set('/app/asset.bin', original);
    apis.writeFile = () => Promise.reject(new Error('disk full'));

    await expect(
      writeFileAtomic(apis, '/app/asset.bin', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/disk full/);
    expect(bin.get('/app/asset.bin')).toEqual(original);
  });

  it('binary: does not throw when best-effort cleanup of the orphaned temp file also fails', async () => {
    const { apis } = makeAtomicWriteFake();
    apis.rename = () => Promise.reject(new Error('EBUSY: file is locked'));
    apis.remove = () => Promise.reject(new Error('ENOENT'));

    await expect(
      writeFileAtomic(apis, '/app/asset.bin', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/locked/);
  });

  // QNBS-v3: same-path writes serialize in call order, so an older (slower) save can never overwrite a newer save's already-committed content.
  it('serializes concurrent writes to the same path in call order, not completion order', async () => {
    const { apis, text } = makeAtomicWriteFake();
    const originalWriteTextFile = apis.writeTextFile;
    let firstWriteStarted = false;
    apis.writeTextFile = async (p, c) => {
      if (p.includes('.tmp-') && c === 'first' && !firstWriteStarted) {
        firstWriteStarted = true;
        // Delay the first (older) write so it would finish AFTER the second one if unserialized.
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return originalWriteTextFile(p, c);
    };

    const first = writeTextFileAtomic(apis, '/app/project.json', 'first');
    const second = writeTextFileAtomic(apis, '/app/project.json', 'second');
    await Promise.all([first, second]);

    // Second (newer) call must be the one that lands, even though the first call's temp write
    // was artificially slower.
    expect(text.get('/app/project.json')).toBe('second');
  });
});

describe('cleanupOrphanedTempFiles', () => {
  // QNBS-v3: reclaims .tmp-* siblings left by writes interrupted by a process kill, which neither atomicRename's nor writeThenRename's in-session cleanup ever sees.
  it('removes .tmp-* files at the root and nested inside subdirectories', async () => {
    const { apis, removed } = makeDirTreeFake({
      '/app': ['project.json.tmp-a1b2c3d4-1111-2222-3333-444444444444', 'config/', 'projects/'],
      '/app/config': ['settings.json'],
      '/app/projects': ['p1/'],
      '/app/projects/p1': ['project.json', 'codex/'],
      '/app/projects/p1/codex': ['codex.snap.tmp-deadbeefcafefeed00112233445566'],
    });

    await cleanupOrphanedTempFiles(apis, '/app');

    expect(removed.sort()).toEqual(
      [
        '/app/project.json.tmp-a1b2c3d4-1111-2222-3333-444444444444',
        '/app/projects/p1/codex/codex.snap.tmp-deadbeefcafefeed00112233445566',
      ].sort(),
    );
  });

  it('does not remove non-temp files', async () => {
    const { apis, removed } = makeDirTreeFake({ '/app': ['project.json', 'settings.json'] });
    await cleanupOrphanedTempFiles(apis, '/app');
    expect(removed).toEqual([]);
  });

  it('does not throw when the root directory does not exist yet (fresh install)', async () => {
    const { apis, removed } = makeDirTreeFake({});
    await expect(cleanupOrphanedTempFiles(apis, '/app')).resolves.toBeUndefined();
    expect(removed).toEqual([]);
  });

  it('stops recursing past the depth guard instead of following an unexpectedly deep tree', async () => {
    const tree: Record<string, string[]> = { '/app': ['d/'] };
    let path = '/app';
    for (let i = 0; i < 10; i++) {
      tree[path] = ['d/'];
      path = `${path}/d`;
    }
    tree[path] = ['leaf.tmp-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4'];
    const { apis, removed } = makeDirTreeFake(tree);

    await expect(cleanupOrphanedTempFiles(apis, '/app')).resolves.toBeUndefined();
    expect(removed).toEqual([]); // the leaf is past the depth guard, never reached
  });
});

describe('protectTextValue / unprotectTextValue / writeProtectedTextFileAtomic / readProtectedTextFile', () => {
  it('passes plaintext through unchanged when no at-rest passphrase is configured', async () => {
    const protectedValue = await protectTextValue('plain compressed data');
    expect(protectedValue).toBe('plain compressed data');
    expect(await unprotectTextValue(protectedValue)).toBe('plain compressed data');
  });

  it('encrypts under the real key when a passphrase is configured and unlocked, and round-trips', async () => {
    await enableTestPassphrase();
    const protectedValue = await protectTextValue('sensitive manuscript text');
    expect(protectedValue).not.toContain('sensitive manuscript text');
    expect(JSON.parse(protectedValue).scheme).toBe('protected-v1');
    expect(await unprotectTextValue(protectedValue)).toBe('sensitive manuscript text');
  });

  it("treats LZ-compressed plaintext (compressData()'s large-payload output) as plaintext, not a protected envelope", async () => {
    const lzLike = `\x00lz1\x00${'x'.repeat(50)}`;
    expect(await unprotectTextValue(lzLike)).toBe(lzLike);
  });

  // QNBS-v3: a truncated/corrupted write that still parses as JSON and claims scheme==='protected-v1' must never be silently loaded as if it were real domain data — throwing surfaces it as corruption instead.
  it('throws on a protected-v1 envelope missing its data field, instead of returning the envelope shell as plaintext', async () => {
    await expect(unprotectTextValue('{"scheme":"protected-v1"}')).rejects.toThrow(
      /malformed protected-v1 envelope/i,
    );
  });

  it('throws on a protected-v1 envelope whose data field has the wrong type, instead of returning the envelope shell as plaintext', async () => {
    await expect(unprotectTextValue('{"scheme":"protected-v1","data":123}')).rejects.toThrow(
      /malformed protected-v1 envelope/i,
    );
  });

  it('treats ordinary domain JSON without a protected-v1 scheme as plaintext, unaffected by the malformed-envelope check', async () => {
    const domainJson = '{"title":"My Novel","scheme":"not-a-real-scheme"}';
    expect(await unprotectTextValue(domainJson)).toBe(domainJson);
  });

  it('throws when a protected value exists but at-rest encryption is no longer configured', async () => {
    await enableTestPassphrase();
    const protectedValue = await protectTextValue('secret');
    cryptoState.activeKey = null;
    cryptoState.sentinelConfigured = false; // sentinel cleared/disabled since this was saved
    await expect(unprotectTextValue(protectedValue)).rejects.toThrow(/no longer configured/);
  });

  it('propagates a locked error (fail closed) when a protected value exists but the session is locked', async () => {
    await enableTestPassphrase();
    const protectedValue = await protectTextValue('secret');
    cryptoState.activeKey = null; // sentinelConfigured stays true — locked, not disabled
    await expect(unprotectTextValue(protectedValue)).rejects.toThrow(/storage is locked/i);
  });

  it('does not expose legacy plaintext while a configured library is locked', async () => {
    cryptoState.sentinelConfigured = true;

    await expect(unprotectTextValue('legacy plaintext')).rejects.toThrow(/storage is locked/i);
  });

  it('reports structurally valid ciphertext with a bad authentication tag as corruption', async () => {
    await enableTestPassphrase();
    const protectedValue = JSON.parse(await protectTextValue('secret')) as { data: string };
    const finalByte = protectedValue.data.endsWith('A') ? 'B' : 'A';
    protectedValue.data = `${protectedValue.data.slice(0, -1)}${finalByte}`;

    await expect(unprotectTextValue(JSON.stringify(protectedValue))).rejects.toBeInstanceOf(
      SecureRecordCorruptError,
    );
  });

  it('writeProtectedTextFileAtomic + readProtectedTextFile round-trip through the filesystem, encrypted', async () => {
    await enableTestPassphrase();
    const { apis, text } = makeAtomicWriteFake();
    await writeProtectedTextFileAtomic(apis, '/app/project.json', '{"title":"My Novel"}');

    expect(text.get('/app/project.json')).not.toContain('My Novel');
    expect(await readProtectedTextFile(apis, '/app/project.json')).toBe('{"title":"My Novel"}');
  });

  it('writeProtectedTextFileAtomic writes plaintext when no passphrase is configured (unchanged default)', async () => {
    const { apis, text } = makeAtomicWriteFake();
    await writeProtectedTextFileAtomic(apis, '/app/project.json', '{"title":"My Novel"}');
    expect(text.get('/app/project.json')).toBe('{"title":"My Novel"}');
  });

  it('holds write admission through atomic publication so a migration cannot overtake the captured key', async () => {
    await enableTestPassphrase();
    const { apis, text } = makeAtomicWriteFake();
    let startWrite: (() => void) | undefined;
    let releaseWrite: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      startWrite = resolve;
    });
    const allowWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    apis.writeTextFile = async (path, content) => {
      startWrite?.();
      await allowWrite;
      text.set(path, content);
    };

    const write = writeProtectedTextFileAtomic(apis, '/app/project.json', '{"title":"My Novel"}');
    await writeStarted;
    let migrationEntered = false;
    const migration = withMigrationAdmission(async () => {
      migrationEntered = true;
    });
    await Promise.resolve();
    expect(migrationEntered).toBe(false);

    releaseWrite?.();
    await Promise.all([write, migration]);
    expect(migrationEntered).toBe(true);
  });

  // QNBS-v3: an older call's key-resolution step used to run OUTSIDE the per-path write queue, so a slower-to-encrypt older save could land in the queue after a faster-to-encrypt newer save and overwrite it — regression test for that ordering gap.
  it('serializes concurrent protected writes to the same path in call order, even when the OLDER call resolves its key slower', async () => {
    await enableTestPassphrase();
    const { apis, text } = makeAtomicWriteFake();
    cryptoState.keyResolutionDelaysMs = [20, 0]; // first (older) call's key resolution is slower

    const first = writeProtectedTextFileAtomic(apis, '/app/project.json', 'first-plaintext');
    const second = writeProtectedTextFileAtomic(apis, '/app/project.json', 'second-plaintext');
    await Promise.all([first, second]);

    const onDisk = text.get('/app/project.json') as string;
    expect(await unprotectTextValue(onDisk)).toBe('second-plaintext');
  });
});

describe('compressData / decompressData', () => {
  it('round-trips small data uncompressed (plain JSON)', () => {
    const data = { a: 1, b: ['x', 'y'], c: 'hello' };
    const raw = compressData(data);
    expect(raw.startsWith('\x00lz1\x00')).toBe(false);
    expect(decompressData(raw)).toEqual(data);
  });

  it('compresses and round-trips large data', () => {
    const data = { big: 'lorem ipsum '.repeat(2000) }; // > 10 KiB JSON
    const raw = compressData(data);
    expect(raw.startsWith('\x00lz1\x00')).toBe(true);
    expect(decompressData(raw)).toEqual(data);
  });

  it('decompresses a corrupt lz payload to an empty object', () => {
    expect(decompressData('\x00lz1\x00@@not-valid@@')).toEqual({});
  });
});

// QNBS-v3 (2026-08-13): the derived-passphrase encryptText/decryptText scheme these tests used to
// cover was retired entirely — its "secret" (`${appDataPath}|${provider}|WorldScriptStudio|v1`)
// was fully public/reconstructible by anyone who could read the encrypted file, providing no real
// confidentiality (see services/fs/settingsFsStore.ts's header comment and AUDIT.md's F-05/F-06
// row). API-key protection now reuses services/storage/storageEncryptionService.ts's real
// passphrase-derived key directly; see tests/unit/services/fs/fsStores.test.ts for that coverage.
describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips arbitrary byte sequences, including zero and high bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 128, 42]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips an empty byte sequence', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array([])))).toEqual(new Uint8Array([]));
  });
});

describe('sanitizePathSegment', () => {
  it('replaces path separators and reserved characters with hyphens', () => {
    expect(sanitizePathSegment('a/b\\c')).toBe('a-b-c');
    expect(sanitizePathSegment('<weird>:"name')).toBe('weird-name');
  });

  it('collapses whitespace and trims hyphens', () => {
    expect(sanitizePathSegment('  hello   world  ')).toBe('hello-world');
  });

  it('returns the fallback for empty/whitespace-only input', () => {
    expect(sanitizePathSegment('   ')).toBe('item');
    expect(sanitizePathSegment('***', 'untitled')).toBe('untitled');
  });

  it('truncates to 120 characters', () => {
    expect(sanitizePathSegment('a'.repeat(300)).length).toBe(120);
  });
});

describe('countProjectWords', () => {
  it('counts words across manuscript sections', () => {
    const project = {
      manuscript: [{ content: 'one two three' }, { content: 'four five' }],
    };
    expect(countProjectWords(project)).toBe(5);
  });

  it('returns 0 for missing or non-array manuscript', () => {
    expect(countProjectWords(undefined)).toBe(0);
    expect(countProjectWords({})).toBe(0);
    expect(countProjectWords({ manuscript: 'nope' })).toBe(0);
  });

  it('ignores empty/whitespace sections', () => {
    expect(countProjectWords({ manuscript: [{ content: '' }, { content: '   ' }] })).toBe(0);
  });
});
