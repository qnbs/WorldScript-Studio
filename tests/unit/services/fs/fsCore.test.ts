/**
 * Tests for services/fs/fsCore.ts — the pure utilities shared by the Tauri FS stores.
 * QNBS-v3 (Phase 2): retry classification, compression round-trip, AES-GCM crypto, path
 * sanitization, and word counting — no Tauri APIs required.
 */

import LZString from 'lz-string';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TauriApis } from '../../../../services/fs/fsCore';
import {
  compressData,
  countProjectWords,
  DecompressionError,
  decompressData,
  decompressJsonText,
  decryptText,
  encryptText,
  ProjectFileLockedError,
  retryFs,
  sanitizePathSegment,
  withProjectFileLock,
  writeTextFileAtomic,
} from '../../../../services/fs/fsCore';

// QNBS-v3 (CodeRabbit #363): vi.hoisted — vi.mock factories run before ordinary top-level
// initializers, so a plain `const` here risks a temporal-dead-zone read on the mock path.
const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }));
vi.mock('../../../../services/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

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

describe('writeTextFileAtomic', () => {
  function makeApis(overrides: Partial<TauriApis> = {}): TauriApis {
    return {
      readTextFile: vi.fn(),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      exists: vi.fn(),
      readDir: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      save: vi.fn(),
      appDataDir: vi.fn(),
      join: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    mockLoggerWarn.mockClear();
  });

  it('writes to a temp sibling then renames it into place', async () => {
    const apis = makeApis();
    await writeTextFileAtomic(apis, '/data/project.json', '{"a":1}');

    expect(apis.writeTextFile).toHaveBeenCalledTimes(1);
    const [temporary, content] = (apis.writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(temporary).toMatch(/^\/data\/project\.json\.tmp-/);
    expect(content).toBe('{"a":1}');
    expect(apis.rename).toHaveBeenCalledWith(temporary, '/data/project.json');
    expect(apis.remove).not.toHaveBeenCalled();
  });

  it('keeps synchronous admission adjacent to rename without a microtask gap', async () => {
    const events: string[] = [];
    const apis = makeApis({
      rename: vi.fn().mockImplementation(async () => {
        events.push('rename');
      }),
    });

    await writeTextFileAtomic(apis, '/data/project.json', 'x', () => {
      events.push('admission');
      queueMicrotask(() => events.push('microtask'));
    });

    expect(events.slice(0, 2)).toEqual(['admission', 'rename']);
  });

  it('removes the orphaned temp file and rethrows the original error when the write fails', async () => {
    const apis = makeApis({ writeTextFile: vi.fn().mockRejectedValue(new Error('disk full')) });

    await expect(writeTextFileAtomic(apis, '/data/project.json', 'x')).rejects.toThrow('disk full');
    expect(apis.remove).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('removes the temp file and rethrows the original error when rename fails', async () => {
    const apis = makeApis({ rename: vi.fn().mockRejectedValue(new Error('EPERM')) });

    await expect(writeTextFileAtomic(apis, '/data/project.json', 'x')).rejects.toThrow('EPERM');
    expect(apis.remove).toHaveBeenCalledTimes(1);
  });

  it('logs a warning but still rethrows the original error when temp-file cleanup itself fails', async () => {
    // QNBS-v3: a non-transient message keeps the cleanup retry a single immediate attempt — a transient-looking one (e.g. "busy") would trigger real 500ms retry delays here.
    const apis = makeApis({
      rename: vi.fn().mockRejectedValue(new Error('EPERM')),
      remove: vi.fn().mockRejectedValue(new Error('access denied')),
    });

    await expect(writeTextFileAtomic(apis, '/data/project.json', 'x')).rejects.toThrow('EPERM');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to remove temp file after a failed atomic write',
      expect.objectContaining({ error: 'access denied' }),
    );
  });
});

describe('withProjectFileLock', () => {
  // QNBS-v3 (#553): an in-memory exclusive-create-aware fake — real enough to exercise the lock's create/read/remove sequence without needing the full FsProjectStore fixture.
  function makeLockableApis(initialLocks: Record<string, string> = {}): TauriApis {
    const locks = new Map(Object.entries(initialLocks));
    return {
      readTextFile: vi.fn((path: string) => {
        if (!locks.has(path)) return Promise.reject(new Error(`ENOENT ${path}`));
        return Promise.resolve(locks.get(path) as string);
      }),
      writeTextFile: vi.fn((path: string, content: string, opts?: { createNew?: boolean }) => {
        if (opts?.createNew && locks.has(path)) return Promise.reject(new Error(`EEXIST ${path}`));
        locks.set(path, content);
        return Promise.resolve();
      }),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      exists: vi.fn(),
      readDir: vi.fn(),
      remove: vi.fn((path: string) => {
        locks.delete(path);
        return Promise.resolve();
      }),
      rename: vi.fn(),
      open: vi.fn(),
      save: vi.fn(),
      appDataDir: vi.fn(),
      join: vi.fn(),
    };
  }

  it('acquires the lock, runs the operation, and releases it on success', async () => {
    const apis = makeLockableApis();
    const result = await withProjectFileLock(apis, '/data/project.json', async () => 'done');

    expect(result).toBe('done');
    expect(apis.writeTextFile).toHaveBeenCalledWith('/data/project.json.lock', expect.any(String), {
      createNew: true,
    });
    expect(apis.remove).toHaveBeenCalledWith('/data/project.json.lock');
  });

  it('releases the lock even when the wrapped operation throws', async () => {
    const apis = makeLockableApis();

    await expect(
      withProjectFileLock(apis, '/data/project.json', async () => {
        throw new Error('writeback refused');
      }),
    ).rejects.toThrow('writeback refused');
    expect(apis.remove).toHaveBeenCalledWith('/data/project.json.lock');
  });

  it('throws ProjectFileLockedError after bounded retries when a lock is already held', async () => {
    const apis = makeLockableApis({ '/data/project.json.lock': 'locked' });
    const fn = vi.fn().mockResolvedValue('unreachable');

    await expect(withProjectFileLock(apis, '/data/project.json', fn)).rejects.toBeInstanceOf(
      ProjectFileLockedError,
    );
    expect(fn).not.toHaveBeenCalled();
    // QNBS-v3: bounded — exactly 3 create attempts, never an unbounded wait, and never a remove of the held lock (no reclaim exists).
    expect(apis.writeTextFile).toHaveBeenCalledTimes(3);
    expect(apis.remove).not.toHaveBeenCalled();
  });

  it('does not fail the operation when best-effort lock release itself fails', async () => {
    const apis = makeLockableApis();
    apis.remove = vi.fn().mockRejectedValue(new Error('EPERM'));

    await expect(withProjectFileLock(apis, '/data/project.json', async () => 'done')).resolves.toBe(
      'done',
    );
  });

  // QNBS-v3 (#553): a permission/disk-full/missing-directory failure must propagate as itself — never be silently retried and misreported as lock contention.
  it('propagates a non-contention filesystem error immediately, without retrying or misreporting it', async () => {
    const apis = makeLockableApis();
    apis.writeTextFile = vi.fn().mockRejectedValue(new Error('EACCES: permission denied'));
    const fn = vi.fn();

    await expect(withProjectFileLock(apis, '/data/project.json', fn)).rejects.toThrow(
      'permission denied',
    );
    expect(fn).not.toHaveBeenCalled();
    expect(apis.writeTextFile).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3 (#553): the mutual-exclusion proof every reviewed reclaim strategy would have defeated — a second caller must be refused, never admitted, while the first still holds the lock.
  it('never admits a second caller while the first still holds the lock (mutual exclusion proof)', async () => {
    const apis = makeLockableApis();
    let releaseFirst!: () => void;
    const firstOperation = new Promise<string>((resolve) => {
      releaseFirst = () => resolve('first');
    });

    const firstCall = withProjectFileLock(apis, '/data/project.json', () => firstOperation);
    // QNBS-v3: yields once so the first call's exclusive-create has actually landed before the second attempts it.
    await Promise.resolve();
    await Promise.resolve();

    const secondFn = vi.fn().mockResolvedValue('second');
    const secondCall = withProjectFileLock(apis, '/data/project.json', secondFn);

    await expect(secondCall).rejects.toBeInstanceOf(ProjectFileLockedError);
    expect(secondFn).not.toHaveBeenCalled();

    releaseFirst();
    await expect(firstCall).resolves.toBe('first');
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

  // QNBS-v3 (DA-01): was 'decompresses a corrupt lz payload to an empty object' — must fail closed instead.
  it('throws DecompressionError on a corrupt/truncated lz payload instead of substituting {}', () => {
    expect(() => decompressData('\x00lz1\x00@@not-valid@@')).toThrow(DecompressionError);
  });

  it('throws DecompressionError (not a bare SyntaxError) when decompression succeeds but the result is not valid JSON', () => {
    const raw = `\x00lz1\x00${LZString.compressToUTF16('this is not valid json {{{')}`;
    expect(() => decompressData(raw)).toThrow(DecompressionError);
  });

  it('throws DecompressionError (not a bare SyntaxError) for malformed uncompressed JSON', () => {
    expect(() => decompressData('this is not json {{{')).toThrow(DecompressionError);
  });

  it('returns decompressed JSON text without normalizing numeric literals', () => {
    const source = '{"opaque":9007199254740993.0000000000001}';
    const compressed = `\x00lz1\x00${LZString.compressToUTF16(source)}`;

    expect(decompressJsonText(source)).toBe(source);
    expect(decompressJsonText(compressed)).toBe(source);
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

  // QNBS-v3 (F-05/F-06 fix, 2026-07-29): regression guard for the PBKDF2 + random-salt derivation
  // replacing the prior unsalted single-SHA-256 scheme.
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
