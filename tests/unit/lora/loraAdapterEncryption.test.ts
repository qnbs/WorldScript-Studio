// @vitest-environment node
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  _resetLoraDbForTest,
  type LoraAdapterMeta,
  listAdapters,
  listDatasetEntries,
  listTrainingRuns,
  type StoredDatasetEntry,
  type StoredTrainingRun,
  saveAdapter,
  saveDatasetEntries,
  saveTrainingRun,
} from '../../../services/loraAdapterService';
import { _resetPassphraseSentinelForTest } from '../../../services/storage/idbPassphraseSentinel';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  setupIdbEncryption,
} from '../../../services/storage/storageEncryptionService';

const DB_NAME = 'worldscript-lora-db';
const META_STORE = 'lora-meta';
const BLOB_STORE = 'lora-blobs';
const DATASETS_STORE = 'lora-datasets';
const RUNS_STORE = 'lora-runs';

const META: LoraAdapterMeta = {
  id: 'secure-adapter',
  name: 'LORA_NAME_CANARY',
  description: 'LORA_DESCRIPTION_CANARY',
  modelCompatibility: 'LORA_MODEL_CANARY',
  scale: 0.75,
  fileSizeBytes: 4,
  createdAt: 1716000000000,
  projectId: 'project-lora',
  localPath: '/private/LORA_PATH_CANARY.safetensors',
};

const DATASET: StoredDatasetEntry = {
  id: 'secure-dataset',
  projectId: 'project-lora',
  instruction: 'LORA_INSTRUCTION_CANARY',
  input: 'LORA_INPUT_CANARY',
  output: 'LORA_OUTPUT_CANARY',
  source: 'extracted',
  qualityScore: 0.8,
  wordCount: 3,
  createdAt: 1716000000000,
};

const RUN: StoredTrainingRun = {
  id: 'secure-run',
  projectId: 'project-lora',
  baseModelId: 'LORA_BASE_MODEL_CANARY',
  presetId: 'LORA_PRESET_CANARY',
  status: 'failed',
  progressPercent: 42,
  currentEpoch: 2,
  totalEpochs: 4,
  currentLoss: 0.33,
  lossHistory: [0.9, 0.5, 0.33],
  startedAt: 1716000000000,
  completedAt: 1716003600000,
  errorMessage: 'LORA_ERROR_CANARY',
};

async function readRaw(
  storeName: string,
  key: string,
): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeRaw(storeName: string, record: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

beforeEach(() => {
  _resetLoraDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  _resetLoraDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
});

describe('loraAdapterService encrypted persistence', () => {
  it('encrypts adapter metadata while leaving the documented weight blob outside the guarantee', async () => {
    await setupIdbEncryption('lora-passphrase');
    const blob = new Uint8Array([11, 22, 33, 44]).buffer;

    await saveAdapter(META, blob);
    const rawMeta = await readRaw(META_STORE, META.id);
    const rawBlob = await readRaw(BLOB_STORE, META.id);

    expect(rawMeta?.['projectId']).toBe('project-lora');
    expect(isSecureRecordEnvelope(rawMeta?.['payload'])).toBe(true);
    expect(JSON.stringify(rawMeta)).not.toContain('LORA_NAME_CANARY');
    expect(JSON.stringify(rawMeta)).not.toContain('LORA_DESCRIPTION_CANARY');
    expect(JSON.stringify(rawMeta)).not.toContain('LORA_PATH_CANARY');
    expect(new Uint8Array(rawBlob?.['data'] as ArrayBuffer)).toEqual(new Uint8Array(blob));
    await expect(listAdapters()).resolves.toEqual([META]);
  });

  it('encrypts LoRA instruction, input, and output dataset records', async () => {
    await setupIdbEncryption('lora-passphrase');

    await saveDatasetEntries([DATASET]);
    const raw = await readRaw(DATASETS_STORE, DATASET.id);

    expect(raw?.['projectId']).toBe('project-lora');
    expect(raw?.['source']).toBe('extracted');
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('LORA_INSTRUCTION_CANARY');
    expect(JSON.stringify(raw)).not.toContain('LORA_INPUT_CANARY');
    expect(JSON.stringify(raw)).not.toContain('LORA_OUTPUT_CANARY');
    await expect(listDatasetEntries('project-lora')).resolves.toEqual([DATASET]);
  });

  it('encrypts sensitive LoRA training-run metadata', async () => {
    await setupIdbEncryption('lora-passphrase');

    await saveTrainingRun(RUN);
    const raw = await readRaw(RUNS_STORE, RUN.id);

    expect(raw?.['projectId']).toBe('project-lora');
    expect(raw?.['status']).toBe('failed');
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('LORA_BASE_MODEL_CANARY');
    expect(JSON.stringify(raw)).not.toContain('LORA_PRESET_CANARY');
    expect(JSON.stringify(raw)).not.toContain('LORA_ERROR_CANARY');
    await expect(listTrainingRuns('project-lora')).resolves.toEqual([RUN]);
  });

  it('rejects all content-bearing LoRA stores while configured encryption is locked', async () => {
    await setupIdbEncryption('lora-passphrase');
    await saveAdapter(META, new ArrayBuffer(4));
    await saveDatasetEntries([DATASET]);
    await saveTrainingRun(RUN);
    clearIdbEncryptionKey();

    await expect(listAdapters()).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(listDatasetEntries('project-lora')).rejects.toBeInstanceOf(
      SecureRecordLockedError,
    );
    await expect(listTrainingRuns('project-lora')).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(
      saveAdapter({ ...META, id: 'locked-write' }, new ArrayBuffer(4)),
    ).rejects.toBeInstanceOf(SecureRecordLockedError);
  });

  it('lazily migrates legacy meta, dataset, and training records after unlock', async () => {
    await saveAdapter(META, new ArrayBuffer(4));
    await saveDatasetEntries([DATASET]);
    await saveTrainingRun(RUN);
    await writeRaw(META_STORE, META as unknown as Record<string, unknown>);
    await writeRaw(DATASETS_STORE, DATASET as unknown as Record<string, unknown>);
    await writeRaw(RUNS_STORE, RUN as unknown as Record<string, unknown>);
    await setupIdbEncryption('lora-passphrase');

    await expect(listAdapters()).resolves.toEqual([META]);
    await expect(listDatasetEntries('project-lora')).resolves.toEqual([DATASET]);
    await expect(listTrainingRuns('project-lora')).resolves.toEqual([RUN]);
    expect(isSecureRecordEnvelope((await readRaw(META_STORE, META.id))?.['payload'])).toBe(true);
    expect(isSecureRecordEnvelope((await readRaw(DATASETS_STORE, DATASET.id))?.['payload'])).toBe(
      true,
    );
    expect(isSecureRecordEnvelope((await readRaw(RUNS_STORE, RUN.id))?.['payload'])).toBe(true);
  });

  it('fails closed when encrypted adapter metadata is corrupted', async () => {
    await setupIdbEncryption('lora-passphrase');
    await saveAdapter(META, new ArrayBuffer(4));
    const raw = await readRaw(META_STORE, META.id);
    const payload = raw?.['payload'];
    if (!raw || !isSecureRecordEnvelope(payload)) throw new Error('Expected LoRA meta envelope');
    const ciphertext = new Uint8Array(payload.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await writeRaw(META_STORE, { ...raw, payload: { ...payload, ciphertext } });

    await expect(listAdapters()).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });
});
