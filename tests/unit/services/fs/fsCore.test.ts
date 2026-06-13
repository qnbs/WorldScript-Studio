/**
 * Tests for services/fs/fsCore.ts — the pure utilities shared by the Tauri FS stores.
 * QNBS-v3 (Phase 2): retry classification, compression round-trip, AES-GCM crypto, path
 * sanitization, and word counting — no Tauri APIs required.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  compressData,
  countProjectWords,
  decompressData,
  decryptText,
  encryptText,
  retryFs,
  sanitizePathSegment,
} from '../../../../services/fs/fsCore';

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
    expect(payload.data).toBeTruthy();
    await expect(decryptText(payload, 'passphrase-123')).resolves.toBe('top secret manuscript');
  });

  it('fails to decrypt with the wrong secret', async () => {
    const payload = await encryptText('top secret', 'right-key');
    await expect(decryptText(payload, 'wrong-key')).rejects.toBeDefined();
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
