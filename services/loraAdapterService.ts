import { logger } from './logger';

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export async function listAdapters(): Promise<LoraAdapterMeta[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve((req.result as LoraAdapterMeta[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    logger.warn('loraAdapterService: listAdapters failed', { err });
    return [];
  }
}

export async function getAdaptersByProject(projectId: string): Promise<LoraAdapterMeta[]> {
  try {
    const all = await listAdapters();
    return all.filter((a) => a.projectId === projectId);
  } catch (err) {
    logger.warn('loraAdapterService: getAdaptersByProject failed', { err });
    return [];
  }
}

export async function saveAdapter(meta: LoraAdapterMeta, blob: ArrayBuffer): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(BLOB_STORE).put({ id: meta.id, data: blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAdapter(id: string): Promise<void> {
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
  // Mark old active adapter as inactive, new one as active
  const all = await listAdapters();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, ACTIVE_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    for (const adapter of all) {
      metaStore.put({ ...adapter, isActive: adapter.id === id });
    }
    tx.objectStore(ACTIVE_STORE).put(id, ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deactivateAdapter(): Promise<void> {
  const db = await openDb();
  const all = await listAdapters();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, ACTIVE_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    for (const adapter of all) {
      metaStore.put({ ...adapter, isActive: false });
    }
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(activeId);
      req.onsuccess = () => resolve((req.result as LoraAdapterMeta) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
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
  const existing = await new Promise<LoraAdapterMeta | undefined>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(meta.id);
    req.onsuccess = () => resolve(req.result as LoraAdapterMeta | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!existing) throw new Error(`Adapter ${meta.id} not found`);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ ...existing, ...meta });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function saveDatasetEntries(entries: StoredDatasetEntry[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATASETS_STORE, 'readwrite');
    const store = tx.objectStore(DATASETS_STORE);
    for (const entry of entries) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listDatasetEntries(projectId: string): Promise<StoredDatasetEntry[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DATASETS_STORE, 'readonly');
      const idx = tx.objectStore(DATASETS_STORE).index('by_project');
      const req = idx.getAll(projectId);
      req.onsuccess = () => resolve((req.result as StoredDatasetEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
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

export async function saveTrainingRun(run: StoredTrainingRun): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RUNS_STORE, 'readwrite');
    tx.objectStore(RUNS_STORE).put(run);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listTrainingRuns(projectId: string): Promise<StoredTrainingRun[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RUNS_STORE, 'readonly');
      const idx = tx.objectStore(RUNS_STORE).index('by_project');
      const req = idx.getAll(projectId);
      req.onsuccess = () => resolve((req.result as StoredTrainingRun[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    logger.warn('loraAdapterService: listTrainingRuns failed', { err });
    return [];
  }
}

/** Reset the IDB for unit tests. */
export function _resetLoraDbForTest(): void {
  // Re-assign global so the next openDb() call starts fresh
  if (typeof global !== 'undefined' && 'IDBFactory' in global) {
    const { IDBFactory } = global as unknown as { IDBFactory: new () => IDBDatabase };
    (global as unknown as { indexedDB: IDBDatabase }).indexedDB = new IDBFactory();
  }
}
