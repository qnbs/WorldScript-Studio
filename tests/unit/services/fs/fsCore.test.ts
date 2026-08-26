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
  decompressData,
  DecompressionError,
  decryptText,
  encryptText,
  retryFs,
  sanitizePathSegment,
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
