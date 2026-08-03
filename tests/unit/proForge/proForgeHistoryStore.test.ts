// @vitest-environment node
// QNBS-v3: node environment + fresh IDBFactory per test for full isolation (mirrors memory-bank test).

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineRun } from '../../../features/proForge/types';
import {
  _resetHistoryDbForTest,
  loadRunHistory,
  MAX_RUN_HISTORY,
  saveRunHistory,
} from '../../../services/proForge/proForgeHistoryStore';
import { _resetPassphraseSentinelForTest } from '../../../services/storage/idbPassphraseSentinel';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  setupIdbEncryption,
} from '../../../services/storage/storageEncryptionService';

const DB_NAME = 'proforge-run-history';
const STORE = 'history';

async function readRawHistory(projectId: string): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(projectId);
    request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawHistory(record: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

beforeEach(() => {
  _resetHistoryDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  _resetHistoryDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
});

function run(id: string): PipelineRun {
  return {
    id,
    projectId: 'p1',
    label: id,
    config: {} as PipelineRun['config'],
    status: 'completed',
    activeStage: 'archived',
    stages: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    prePipelineSnapshotId: 'snap-1',
    traceLog: [],
  };
}

describe('proForgeHistoryStore', () => {
  it('returns an empty array when nothing is persisted', async () => {
    expect(await loadRunHistory('p1')).toEqual([]);
  });

  it('round-trips run history for a project', async () => {
    await saveRunHistory('p1', [run('a'), run('b')]);
    const loaded = await loadRunHistory('p1');
    expect(loaded.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('scopes history by project id', async () => {
    await saveRunHistory('p1', [run('a')]);
    await saveRunHistory('p2', [run('z')]);
    expect((await loadRunHistory('p2')).map((r) => r.id)).toEqual(['z']);
    expect((await loadRunHistory('p1')).map((r) => r.id)).toEqual(['a']);
  });

  it('caps stored history to MAX_RUN_HISTORY (most-recent-first)', async () => {
    const many = Array.from({ length: MAX_RUN_HISTORY + 5 }, (_, i) => run(`r${i}`));
    await saveRunHistory('p1', many);
    const loaded = await loadRunHistory('p1');
    expect(loaded).toHaveLength(MAX_RUN_HISTORY);
    expect(loaded[0]?.id).toBe('r0');
  });

  it('overwrites prior history for the same project', async () => {
    await saveRunHistory('p1', [run('old')]);
    await saveRunHistory('p1', [run('new')]);
    expect((await loadRunHistory('p1')).map((r) => r.id)).toEqual(['new']);
  });

  it('encrypts the complete pipeline-run payload in raw IndexedDB', async () => {
    const canary = 'PROFORGE_RUN_CANARY_14ce';
    await setupIdbEncryption('history-passphrase');

    await saveRunHistory('p-encrypted', [run(canary)]);
    const raw = await readRawHistory('p-encrypted');

    expect(raw?.['projectId']).toBe('p-encrypted');
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain(canary);
    await expect(loadRunHistory('p-encrypted')).resolves.toEqual([run(canary)]);
  });

  it('rejects history reads and writes while configured encryption is locked', async () => {
    await setupIdbEncryption('history-passphrase');
    await saveRunHistory('p-locked', [run('locked')]);
    clearIdbEncryptionKey();

    await expect(loadRunHistory('p-locked')).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(saveRunHistory('p-locked', [run('new')])).rejects.toBeInstanceOf(
      SecureRecordLockedError,
    );
  });

  it('lazily rewrites a legacy plaintext run history after unlock', async () => {
    await saveRunHistory('seed', []);
    await writeRawHistory({ projectId: 'p-legacy', runs: [run('LEGACY_RUN_CANARY')] });
    expect(JSON.stringify(await readRawHistory('p-legacy'))).toContain('LEGACY_RUN_CANARY');
    await setupIdbEncryption('history-passphrase');

    await expect(loadRunHistory('p-legacy')).resolves.toEqual([run('LEGACY_RUN_CANARY')]);
    const migrated = await readRawHistory('p-legacy');
    expect(isSecureRecordEnvelope(migrated?.['payload'])).toBe(true);
    expect(JSON.stringify(migrated)).not.toContain('LEGACY_RUN_CANARY');
  });

  it('fails closed when encrypted run history is corrupted', async () => {
    await setupIdbEncryption('history-passphrase');
    await saveRunHistory('p-corrupt', [run('CORRUPTION_CANARY')]);
    const raw = await readRawHistory('p-corrupt');
    const payload = raw?.['payload'];
    if (!raw || !isSecureRecordEnvelope(payload)) throw new Error('Expected history envelope');
    const ciphertext = new Uint8Array(payload.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await writeRawHistory({ ...raw, payload: { ...payload, ciphertext } });

    await expect(loadRunHistory('p-corrupt')).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });
});
