/**
 * Tests for services/duckdb/codexExcerptEncryptionMigration.ts (SEC-6).
 * QNBS-v3: Deliberately does NOT mock storageEncryptionService or duckdbEncryption — this test
 * exercises the REAL AES-256-GCM crypto path (only the DuckDB transport layer is mocked), so a
 * wiring bug between this migration and the encryption module can't hide behind a stubbed crypto call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/duckdb/duckdbClient', () => ({
  duckdbClient: {
    query: vi.fn(),
    exec: vi.fn(),
  },
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  isCodexExcerptEncryptionMigrationDone,
  runCodexExcerptEncryptionMigration,
} from '../../../../services/duckdb/codexExcerptEncryptionMigration';
import { duckdbClient } from '../../../../services/duckdb/duckdbClient';
import {
  clearIdbEncryptionKey,
  initIdbEncryption,
} from '../../../../services/storage/storageEncryptionService';

const mockQuery = vi.mocked(duckdbClient.query);
const mockExec = vi.mocked(duckdbClient.exec);

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue({ messageId: 'm', ok: true });
  clearIdbEncryptionKey();
});

afterEach(() => {
  clearIdbEncryptionKey();
});

describe('isCodexExcerptEncryptionMigrationDone', () => {
  it('returns true when the _meta marker row exists', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [{ value: '1' }] });
    expect(await isCodexExcerptEncryptionMigrationDone()).toBe(true);
  });

  it('returns false when no _meta marker row', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    expect(await isCodexExcerptEncryptionMigrationDone()).toBe(false);
  });

  it('returns false when the query fails', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: false });
    expect(await isCodexExcerptEncryptionMigrationDone()).toBe(false);
  });
});

describe('runCodexExcerptEncryptionMigration', () => {
  it('is a no-op when already marked done', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [{ value: '1' }] });
    const result = await runCodexExcerptEncryptionMigration('proj-1');
    expect(result).toEqual({ migrated: 0, aborted: false });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('reports aborted:false (not a failure) when encryption is not unlocked this session', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    const result = await runCodexExcerptEncryptionMigration('proj-1');
    expect(result).toEqual({ migrated: 0, aborted: false });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('aborts (retryable) when the privacy gate rejects persistence, even with encryption unlocked', async () => {
    await initIdbEncryption('test-pass');
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    const result = await runCodexExcerptEncryptionMigration('proj-1', () => false);
    expect(result).toEqual({ migrated: 0, aborted: true });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('aborts (retryable) when the plaintext-row query fails', async () => {
    await initIdbEncryption('test-pass');
    mockQuery
      .mockResolvedValueOnce({ messageId: 'm1', ok: true, rows: [] })
      .mockResolvedValueOnce({ messageId: 'm2', ok: false, error: 'boom' });
    const result = await runCodexExcerptEncryptionMigration('proj-1');
    expect(result).toEqual({ migrated: 0, aborted: true });
  });

  it('encrypts plaintext excerpt rows via the real AES-256-GCM path and nulls the plaintext column', async () => {
    await initIdbEncryption('test-pass');
    mockQuery
      .mockResolvedValueOnce({ messageId: 'm1', ok: true, rows: [] }) // isDone check
      .mockResolvedValueOnce({
        messageId: 'm2',
        ok: true,
        rows: [
          {
            entity_id: 'e1',
            project_id: 'proj-1',
            section_id: 's1',
            excerpt: 'secret manuscript prose',
          },
        ],
      });

    const result = await runCodexExcerptEncryptionMigration('proj-1');

    expect(result).toEqual({ migrated: 1, aborted: false });

    const updateCall = mockExec.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE codex_mentions'),
    );
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall as [string, unknown[]];
    // No plaintext leak into the SQL string itself.
    expect(sql).not.toContain('secret manuscript prose');
    expect(params).toHaveLength(1);
    const bytes = params[0] as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const markerCall = mockExec.mock.calls.find(([execSql]) =>
      String(execSql).includes('codex_excerpt_encryption_v1_migrated'),
    );
    expect(markerCall).toBeDefined();
  });

  it('aborts without writing the done-marker when the privacy gate flips off mid-batch', async () => {
    await initIdbEncryption('test-pass');
    let calls = 0;
    const gate = () => {
      calls++;
      return calls <= 1;
    };
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows: [] }).mockResolvedValueOnce({
      messageId: 'm2',
      ok: true,
      rows: [{ entity_id: 'e1', project_id: 'proj-1', section_id: 's1', excerpt: 'a' }],
    });

    const result = await runCodexExcerptEncryptionMigration('proj-1', gate);

    expect(result.aborted).toBe(true);
    expect(
      mockExec.mock.calls.some(([execSql]) =>
        String(execSql).includes('codex_excerpt_encryption_v1_migrated'),
      ),
    ).toBe(false);
  });
});
