import { logger } from './logger';
import {
  assertSecureStorageWritableForMutation,
  isSecureRecordEnvelope,
  prepareSecureRecordPayload,
  prepareSecureRecordPayloadWithKey,
  readSecureRecordPayload,
  reEncryptSecureRecordEnvelope,
  SecureRecordCorruptError,
  type SecureRecordEnvelope,
  SecureRecordLockedError,
} from './storage/storageEncryptionService';

export interface LoraAdapterMeta {
  id: string;
  name: string;
  description: string;
  /** Base model ID this adapter was trained for (e.g. a WebLLM model ID). */
  modelCompatibility: string;
  /** LoRA scale α: 0 = disabled, 1 = full, >1 = amplified. */
  scale: number;
  fileSizeBytes: number;
  createdAt: number;
  /** Project this adapter was trained on (optional for imported adapters). */
  projectId?: string;
  /** Adapter format on disk. */
  format?: 'safetensors' | 'gguf' | 'merged-gguf';
  /** Base version ID this adapter was versioned from. */
  baseVersionId?: string;
  /** Monotonically increasing version number within a lineage. */
  version?: number;
  /** Whether this adapter is currently active for inference. */
  isActive?: boolean;
  /** Style Consistency Score from loraEvaluationService (0–1). */
  qualityScore?: number;
  /** Path on disk (Tauri desktop only). */
  localPath?: string;
}

const DB_NAME = 'worldscript-lora-db';
// QNBS-v3: v2 — adds lora-datasets, lora-runs, lora-active stores.
const DB_VERSION = 2;
const META_STORE = 'lora-meta';
const BLOB_STORE = 'lora-blobs';
const DATASETS_STORE = 'lora-datasets';
const RUNS_STORE = 'lora-runs';
const ACTIVE_STORE = 'lora-active';

const ACTIVE_KEY = 'active_adapter_id';
const RECORD_SCHEMA_VERSION = 1;

type LoraAdapterMetaPayload = Omit<LoraAdapterMeta, 'id' | 'projectId' | 'createdAt'>;

interface StoredLoraAdapterMeta {
  id: string;
  projectId?: string;
  createdAt: number;
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  payload: LoraAdapterMetaPayload | SecureRecordEnvelope;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbHandle: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
      // v2 additions
      if (!db.objectStoreNames.contains(DATASETS_STORE)) {
        const dsStore = db.createObjectStore(DATASETS_STORE, { keyPath: 'id' });
        dsStore.createIndex('by_project', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        const runStore = db.createObjectStore(RUNS_STORE, { keyPath: 'id' });
        runStore.createIndex('by_project', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(ACTIVE_STORE)) {
        db.createObjectStore(ACTIVE_STORE);
      }
    };
    req.onsuccess = (e) => {
      dbHandle = (e.target as IDBOpenDBRequest).result;
      dbHandle.onversionchange = () => {
        dbHandle?.close();
        dbHandle = null;
        dbPromise = null;
      };
      resolve(dbHandle);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function adapterMetaPayload(meta: LoraAdapterMeta): LoraAdapterMetaPayload {
  return {
    name: meta.name,
    description: meta.description,
    modelCompatibility: meta.modelCompatibility,
    scale: meta.scale,
    fileSizeBytes: meta.fileSizeBytes,
    ...(meta.format !== undefined && { format: meta.format }),
    ...(meta.baseVersionId !== undefined && { baseVersionId: meta.baseVersionId }),
    ...(meta.version !== undefined && { version: meta.version }),
    ...(meta.isActive !== undefined && { isActive: meta.isActive }),
    ...(meta.qualityScore !== undefined && { qualityScore: meta.qualityScore }),
    ...(meta.localPath !== undefined && { localPath: meta.localPath }),
  };
}

async function encodeAdapterMeta(meta: LoraAdapterMeta): Promise<StoredLoraAdapterMeta> {
  return {
    id: meta.id,
    createdAt: meta.createdAt,
    schemaVersion: RECORD_SCHEMA_VERSION,
    ...(meta.projectId !== undefined && { projectId: meta.projectId }),
    payload: await prepareSecureRecordPayload(adapterMetaPayload(meta), {
      store: 'lora-adapter-meta',
      recordId: meta.id,
    }),
  };
}

async function decodeAdapterMeta(
  stored: StoredLoraAdapterMeta | LoraAdapterMeta,
): Promise<{ meta: LoraAdapterMeta; needsMigration: boolean }> {
  const context = { store: 'lora-adapter-meta', recordId: stored.id };
  if ('payload' in stored) {
    const decoded = await readSecureRecordPayload<LoraAdapterMetaPayload>(stored.payload, context);
    return {
      meta: {
        id: stored.id,
        createdAt: stored.createdAt,
        ...(stored.projectId !== undefined && { projectId: stored.projectId }),
        ...decoded.value,
      },
      needsMigration: decoded.needsMigration,
    };
  }

  const decoded = await readSecureRecordPayload<LoraAdapterMetaPayload>(
    adapterMetaPayload(stored),
    context,
  );
  return {
    meta: {
      id: stored.id,
      createdAt: stored.createdAt,
      ...(stored.projectId !== undefined && { projectId: stored.projectId }),
      ...decoded.value,
    },
    needsMigration: decoded.needsMigration,
  };
}

function rethrowSecureRecordError(error: unknown): void {
  if (error instanceof SecureRecordLockedError || error instanceof SecureRecordCorruptError) {
    throw error;
  }
}

async function putRecords(
  db: IDBDatabase,
  storeName: string,
  records: Array<Record<string, unknown> | object>,
): Promise<void> {
  if (records.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const record of records) store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function listAdapters(): Promise<LoraAdapterMeta[]> {
  try {
    const db = await openDb();
    const raw = await new Promise<Array<StoredLoraAdapterMeta | LoraAdapterMeta>>(
      (resolve, reject) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const req = tx.objectStore(META_STORE).getAll();
        req.onsuccess = () => resolve(req.result as Array<StoredLoraAdapterMeta | LoraAdapterMeta>);
        req.onerror = () => reject(req.error);
      },
    );
    const adapters: LoraAdapterMeta[] = [];
    const migrations: StoredLoraAdapterMeta[] = [];
    for (const stored of raw) {
      const decoded = await decodeAdapterMeta(stored);
      adapters.push(decoded.meta);
      if (decoded.needsMigration) migrations.push(await encodeAdapterMeta(decoded.meta));
    }
    await putRecords(db, META_STORE, migrations);
    return adapters;
  } catch (err) {
    rethrowSecureRecordError(err);
    logger.warn('loraAdapterService: listAdapters failed', { err });
    return [];
  }
}

export async function getAdaptersByProject(projectId: string): Promise<LoraAdapterMeta[]> {
  try {
    const all = await listAdapters();
    return all.filter((a) => a.projectId === projectId);
  } catch (err) {
    rethrowSecureRecordError(err);
    logger.warn('loraAdapterService: getAdaptersByProject failed', { err });
    return [];
  }
}

export async function saveAdapter(meta: LoraAdapterMeta, blob: ArrayBuffer): Promise<void> {
  // QNBS-v3: Finish metadata encryption before starting the atomic meta/blob transaction.
  const storedMeta = await encodeAdapterMeta(meta);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(storedMeta);
    tx.objectStore(BLOB_STORE).put({ id: meta.id, data: blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAdapter(id: string): Promise<void> {
  await assertSecureStorageWritableForMutation();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAdapterBlob(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readonly');
      const req = tx.objectStore(BLOB_STORE).get(id);
      req.onsuccess = () => {
        const record = req.result as { id: string; data: ArrayBuffer } | undefined;
        resolve(record?.data ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    logger.warn('loraAdapterService: getAdapterBlob failed', { err });
    return null;
  }
}

export async function activateAdapter(id: string): Promise<void> {
  const db = await openDb();
  const all = await listAdapters();
  // QNBS-v3: Encrypt every updated record before opening the multi-store transaction.
  const updated = await Promise.all(
    all.map((adapter) => encodeAdapterMeta({ ...adapter, isActive: adapter.id === id })),
  );
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, ACTIVE_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    for (const adapter of updated) metaStore.put(adapter);
    tx.objectStore(ACTIVE_STORE).put(id, ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deactivateAdapter(): Promise<void> {
  const db = await openDb();
  const all = await listAdapters();
  const updated = await Promise.all(
    all.map((adapter) => encodeAdapterMeta({ ...adapter, isActive: false })),
  );
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, ACTIVE_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    for (const adapter of updated) metaStore.put(adapter);
    tx.objectStore(ACTIVE_STORE).delete(ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getActiveAdapter(): Promise<LoraAdapterMeta | null> {
  try {
    const db = await openDb();
    const activeId = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(ACTIVE_STORE, 'readonly');
      const req = tx.objectStore(ACTIVE_STORE).get(ACTIVE_KEY);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!activeId) return null;
    const stored = await new Promise<StoredLoraAdapterMeta | LoraAdapterMeta | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(META_STORE, 'readonly');
        const req = tx.objectStore(META_STORE).get(activeId);
        req.onsuccess = () =>
          resolve(req.result as StoredLoraAdapterMeta | LoraAdapterMeta | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    if (!stored) return null;
    const decoded = await decodeAdapterMeta(stored);
    if (decoded.needsMigration) {
      await putRecords(db, META_STORE, [await encodeAdapterMeta(decoded.meta)]);
    }
    return decoded.meta;
  } catch (err) {
    rethrowSecureRecordError(err);
    logger.warn('loraAdapterService: getActiveAdapter failed', { err });
    return null;
  }
}

/** Create a versioned copy of an adapter (increments version number). */
export async function versionAdapter(id: string): Promise<LoraAdapterMeta> {
  const all = await listAdapters();
  const source = all.find((a) => a.id === id);
  if (!source) throw new Error(`Adapter ${id} not found`);

  const lineageBase = source.baseVersionId ?? id;
  const lineage = all.filter((a) => (a.baseVersionId ?? a.id) === lineageBase);
  const nextVersion = Math.max(...lineage.map((a) => a.version ?? 1)) + 1;

  const versioned: LoraAdapterMeta = {
    ...source,
    id: `${id}_v${nextVersion}`,
    baseVersionId: lineageBase,
    version: nextVersion,
    createdAt: Date.now(),
    isActive: false,
  };
  // Store with empty blob (snapshot of meta only; blob is shared via localPath or separate export)
  await saveAdapter(versioned, new ArrayBuffer(0));
  return versioned;
}

export async function listAdapterVersions(baseId: string): Promise<LoraAdapterMeta[]> {
  const all = await listAdapters();
  return all
    .filter((a) => a.id === baseId || a.baseVersionId === baseId)
    .sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
}

export async function exportAdapter(id: string): Promise<Blob> {
  const blob = await getAdapterBlob(id);
  if (!blob) throw new Error(`No blob for adapter ${id}`);
  return new Blob([blob], { type: 'application/octet-stream' });
}

export async function updateAdapterMeta(
  meta: Partial<LoraAdapterMeta> & { id: string },
): Promise<void> {
  const db = await openDb();
  const stored = await new Promise<StoredLoraAdapterMeta | LoraAdapterMeta | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(meta.id);
      req.onsuccess = () =>
        resolve(req.result as StoredLoraAdapterMeta | LoraAdapterMeta | undefined);
      req.onerror = () => reject(req.error);
    },
  );
  if (!stored) throw new Error(`Adapter ${meta.id} not found`);
  const existing = (await decodeAdapterMeta(stored)).meta;
  await putRecords(db, META_STORE, [await encodeAdapterMeta({ ...existing, ...meta })]);
}

// ---------------------------------------------------------------------------
// Dataset entries (stored in lora-datasets store)
// ---------------------------------------------------------------------------

export interface StoredDatasetEntry {
  id: string;
  projectId: string;
  instruction: string;
  input: string;
  output: string;
  source: 'extracted' | 'synthetic';
  qualityScore: number;
  wordCount: number;
  createdAt: number;
}

type DatasetEntryPayload = Omit<StoredDatasetEntry, 'id' | 'projectId' | 'source' | 'createdAt'>;

interface StoredDatasetRecord {
  id: string;
  projectId: string;
  source: StoredDatasetEntry['source'];
  createdAt: number;
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  payload: DatasetEntryPayload | SecureRecordEnvelope;
}

function datasetPayload(entry: StoredDatasetEntry): DatasetEntryPayload {
  return {
    instruction: entry.instruction,
    input: entry.input,
    output: entry.output,
    qualityScore: entry.qualityScore,
    wordCount: entry.wordCount,
  };
}

async function encodeDatasetEntry(entry: StoredDatasetEntry): Promise<StoredDatasetRecord> {
  return {
    id: entry.id,
    projectId: entry.projectId,
    source: entry.source,
    createdAt: entry.createdAt,
    schemaVersion: RECORD_SCHEMA_VERSION,
    payload: await prepareSecureRecordPayload(datasetPayload(entry), {
      store: 'lora-dataset',
      recordId: entry.id,
    }),
  };
}

async function decodeDatasetEntry(
  stored: StoredDatasetRecord | StoredDatasetEntry,
): Promise<{ entry: StoredDatasetEntry; needsMigration: boolean }> {
  const context = { store: 'lora-dataset', recordId: stored.id };
  const decoded = await readSecureRecordPayload<DatasetEntryPayload>(
    'payload' in stored ? stored.payload : datasetPayload(stored),
    context,
  );
  return {
    entry: {
      id: stored.id,
      projectId: stored.projectId,
      source: stored.source,
      createdAt: stored.createdAt,
      ...decoded.value,
    },
    needsMigration: decoded.needsMigration,
  };
}

export async function saveDatasetEntries(entries: StoredDatasetEntry[]): Promise<void> {
  const db = await openDb();
  const stored = await Promise.all(entries.map(encodeDatasetEntry));
  await putRecords(db, DATASETS_STORE, stored);
}

export async function listDatasetEntries(projectId: string): Promise<StoredDatasetEntry[]> {
  try {
    const db = await openDb();
    const raw = await new Promise<Array<StoredDatasetRecord | StoredDatasetEntry>>(
      (resolve, reject) => {
        const tx = db.transaction(DATASETS_STORE, 'readonly');
        const idx = tx.objectStore(DATASETS_STORE).index('by_project');
        const req = idx.getAll(projectId);
        req.onsuccess = () =>
          resolve((req.result as Array<StoredDatasetRecord | StoredDatasetEntry>) ?? []);
        req.onerror = () => reject(req.error);
      },
    );
    const entries: StoredDatasetEntry[] = [];
    const migrations: StoredDatasetRecord[] = [];
    for (const stored of raw) {
      const decoded = await decodeDatasetEntry(stored);
      entries.push(decoded.entry);
      if (decoded.needsMigration) migrations.push(await encodeDatasetEntry(decoded.entry));
    }
    await putRecords(db, DATASETS_STORE, migrations);
    return entries;
  } catch (err) {
    rethrowSecureRecordError(err);
    logger.warn('loraAdapterService: listDatasetEntries failed', { err });
    return [];
  }
}

export async function clearDatasetEntries(projectId: string): Promise<void> {
  const db = await openDb();
  const entries = await listDatasetEntries(projectId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATASETS_STORE, 'readwrite');
    const store = tx.objectStore(DATASETS_STORE);
    for (const e of entries) store.delete(e.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Training runs
// ---------------------------------------------------------------------------

export interface StoredTrainingRun {
  id: string;
  projectId: string;
  baseModelId: string;
  presetId: string;
  status: 'idle' | 'preparing' | 'training' | 'completed' | 'failed' | 'aborted';
  progressPercent: number;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number;
  lossHistory: number[];
  startedAt: number;
  completedAt?: number;
  outputAdapterId?: string;
  errorMessage?: string;
}

type TrainingRunPayload = Omit<
  StoredTrainingRun,
  'id' | 'projectId' | 'status' | 'startedAt' | 'completedAt'
>;

interface StoredTrainingRecord {
  id: string;
  projectId: string;
  status: StoredTrainingRun['status'];
  startedAt: number;
  completedAt?: number;
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  payload: TrainingRunPayload | SecureRecordEnvelope;
}

function trainingRunPayload(run: StoredTrainingRun): TrainingRunPayload {
  return {
    baseModelId: run.baseModelId,
    presetId: run.presetId,
    progressPercent: run.progressPercent,
    currentEpoch: run.currentEpoch,
    totalEpochs: run.totalEpochs,
    currentLoss: run.currentLoss,
    lossHistory: run.lossHistory,
    ...(run.outputAdapterId !== undefined && { outputAdapterId: run.outputAdapterId }),
    ...(run.errorMessage !== undefined && { errorMessage: run.errorMessage }),
  };
}

async function encodeTrainingRun(run: StoredTrainingRun): Promise<StoredTrainingRecord> {
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.completedAt !== undefined && { completedAt: run.completedAt }),
    schemaVersion: RECORD_SCHEMA_VERSION,
    payload: await prepareSecureRecordPayload(trainingRunPayload(run), {
      store: 'lora-training-run',
      recordId: run.id,
    }),
  };
}

async function decodeTrainingRun(
  stored: StoredTrainingRecord | StoredTrainingRun,
): Promise<{ run: StoredTrainingRun; needsMigration: boolean }> {
  const context = { store: 'lora-training-run', recordId: stored.id };
  const decoded = await readSecureRecordPayload<TrainingRunPayload>(
    'payload' in stored ? stored.payload : trainingRunPayload(stored),
    context,
  );
  return {
    run: {
      id: stored.id,
      projectId: stored.projectId,
      status: stored.status,
      startedAt: stored.startedAt,
      ...(stored.completedAt !== undefined && { completedAt: stored.completedAt }),
      ...decoded.value,
    },
    needsMigration: decoded.needsMigration,
  };
}

export async function saveTrainingRun(run: StoredTrainingRun): Promise<void> {
  const db = await openDb();
  await putRecords(db, RUNS_STORE, [await encodeTrainingRun(run)]);
}

export async function listTrainingRuns(projectId: string): Promise<StoredTrainingRun[]> {
  try {
    const db = await openDb();
    const raw = await new Promise<Array<StoredTrainingRecord | StoredTrainingRun>>(
      (resolve, reject) => {
        const tx = db.transaction(RUNS_STORE, 'readonly');
        const idx = tx.objectStore(RUNS_STORE).index('by_project');
        const req = idx.getAll(projectId);
        req.onsuccess = () =>
          resolve((req.result as Array<StoredTrainingRecord | StoredTrainingRun>) ?? []);
        req.onerror = () => reject(req.error);
      },
    );
    const runs: StoredTrainingRun[] = [];
    const migrations: StoredTrainingRecord[] = [];
    for (const stored of raw) {
      const decoded = await decodeTrainingRun(stored);
      runs.push(decoded.run);
      if (decoded.needsMigration) migrations.push(await encodeTrainingRun(decoded.run));
    }
    await putRecords(db, RUNS_STORE, migrations);
    return runs;
  } catch (err) {
    rethrowSecureRecordError(err);
    logger.warn('loraAdapterService: listTrainingRuns failed', { err });
    return [];
  }
}

/** Reset the IDB for unit tests. */
export function _resetLoraDbForTest(): void {
  dbHandle?.close();
  dbHandle = null;
  dbPromise = null;
}

async function reEncryptStoreRecords<T extends { id: string; payload: unknown }>(
  storeName: string,
  secureStore: string,
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  const db = await openDb();
  const raw = await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
  const migrated: T[] = [];
  for (const stored of raw) {
    const context = { store: secureStore, recordId: stored.id };
    const payload = isSecureRecordEnvelope(stored.payload)
      ? await reEncryptSecureRecordEnvelope(stored.payload, context, oldKey, newKey)
      : await prepareSecureRecordPayloadWithKey(stored.payload, context, newKey);
    migrated.push({ ...stored, payload } as T);
  }
  await putRecords(db, storeName, migrated);
}

/** Decrypt all LoRA secure payloads to plaintext before encryption is disabled. */
export async function migrateLoraStoresForDisable(): Promise<void> {
  const db = await openDb();
  for (const [storeName] of [
    [META_STORE] as const,
    [DATASETS_STORE] as const,
    [RUNS_STORE] as const,
  ]) {
    const raw = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    const plaintext: unknown[] = [];
    for (const stored of raw) {
      if (storeName === META_STORE) {
        const decoded = await decodeAdapterMeta(stored as StoredLoraAdapterMeta);
        plaintext.push({
          id: decoded.meta.id,
          createdAt: decoded.meta.createdAt,
          schemaVersion: RECORD_SCHEMA_VERSION,
          ...(decoded.meta.projectId !== undefined && { projectId: decoded.meta.projectId }),
          payload: adapterMetaPayload(decoded.meta),
        });
      } else if (storeName === DATASETS_STORE) {
        const decoded = await decodeDatasetEntry(stored as StoredDatasetRecord);
        plaintext.push({
          id: decoded.entry.id,
          projectId: decoded.entry.projectId,
          source: decoded.entry.source,
          createdAt: decoded.entry.createdAt,
          schemaVersion: RECORD_SCHEMA_VERSION,
          payload: datasetPayload(decoded.entry),
        });
      } else {
        const decoded = await decodeTrainingRun(stored as StoredTrainingRecord);
        plaintext.push({
          id: decoded.run.id,
          projectId: decoded.run.projectId,
          status: decoded.run.status,
          startedAt: decoded.run.startedAt,
          ...(decoded.run.completedAt !== undefined && { completedAt: decoded.run.completedAt }),
          schemaVersion: RECORD_SCHEMA_VERSION,
          payload: trainingRunPayload(decoded.run),
        });
      }
    }
    await putRecords(db, storeName, plaintext as Array<Record<string, unknown>>);
  }
}

/** Re-encrypt all LoRA secure payloads during passphrase rotation. */
export async function reEncryptLoraStores(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  await reEncryptStoreRecords<StoredLoraAdapterMeta>(
    META_STORE,
    'lora-adapter-meta',
    oldKey,
    newKey,
  );
  await reEncryptStoreRecords<StoredDatasetRecord>(DATASETS_STORE, 'lora-dataset', oldKey, newKey);
  await reEncryptStoreRecords<StoredTrainingRecord>(
    RUNS_STORE,
    'lora-training-run',
    oldKey,
    newKey,
  );
}
