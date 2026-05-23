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
}

const DB_NAME = 'storycraft-lora-db';
const DB_VERSION = 1;
const META_STORE = 'lora-meta';
const BLOB_STORE = 'lora-blobs';

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
