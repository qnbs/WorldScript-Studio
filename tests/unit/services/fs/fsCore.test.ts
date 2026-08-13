/**
 * Tests for services/fs/fsCore.ts — the pure utilities shared by the Tauri FS stores.
 * QNBS-v3 (Phase 2): retry classification, compression round-trip, AES-GCM crypto, path
 * sanitization, and word counting — no Tauri APIs required.
 */

import { describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';
import {
  cleanupOrphanedTempFiles,
  compressData,
  countProjectWords,
  decompressData,
  decryptText,
  encryptText,
  retryFs,
  sanitizePathSegment,
  writeFileAtomic,
  writeTextFileAtomic,
} from '../../../../services/fs/fsCore';

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
  const apis: Pick<TauriApis, 'writeTextFile' | 'writeFile' | 'rename' | 'remove'> = {
    writeTextFile: (p, c) => {
      text.set(p, c);
      return Promise.resolve();
    },
    writeFile: (p, d) => {
      bin.set(p, d);
      return Promise.resolve();
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

describe('encryptText / decryptText', () => {
  it('round-trips a value with the same secret', async () => {
    const payload = await encryptText('top secret manuscript', 'passphrase-123');
    expect(payload.iv).toBeTruthy();
    expect(payload.salt).toBeTruthy();
    expect(payload.data).toBeTruthy();
    await expect(decryptText(payload, 'passphrase-123')).resolves.toBe('top secret manuscript');
  });

  it('fails to decrypt with the wrong secret', async () => {
    const payload = await encryptText('top secret', 'right-key');
    await expect(decryptText(payload, 'wrong-key')).rejects.toBeDefined();
  });

  // QNBS-v3 (F-05/F-06 fix, 2026-07-29): regression guard for the PBKDF2 + random-salt derivation replacing the prior unsalted single-SHA-256 scheme.
  it('produces a different ciphertext, iv, and salt on every encryption of the same secret+plaintext', async () => {
    const a = await encryptText('same plaintext', 'same-secret-material');
    const b = await encryptText('same plaintext', 'same-secret-material');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    // Both must still independently decrypt correctly with their own salt/iv.
    await expect(decryptText(a, 'same-secret-material')).resolves.toBe('same plaintext');
    await expect(decryptText(b, 'same-secret-material')).resolves.toBe('same plaintext');
  });

  it('rejects a legacy (pre-2026-07-29) payload with no salt field', async () => {
    const legacyPayload = { iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAA' };
    await expect(decryptText(legacyPayload, 'any-secret')).rejects.toThrow(/legacy/i);
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
