/**
 * IdbConnectionManager — Dual-database lifecycle and shared IDB utilities.
 * QNBS-v3: Extracted from dbService.ts; owns the two IDB connection handles and
 * provides getObjectStore() for all domain store subclasses.
 */

import * as LZString from 'lz-string';
import {
  APP_DATA_STORE,
  BINDER_ASSETS_STORE,
  CODEX_STORE,
  DATA_DB_NAME,
  DB_VERSION,
  IMAGES_STORE,
  PROJECTS_INDEX_STORE,
  RAG_VECTORS_STORE,
  SNAPSHOTS_STORE,
  STATE_DB_NAME,
} from '../dbConstants';
import { migrateLegacyWorldscriptDbIfNeeded } from '../dbMigration';
import { logger } from '../logger';

// LZ-String threshold: compress payloads >10 KB
const COMPRESS_THRESHOLD_BYTES = 10_240;

export function compressData<T>(data: T): string | T {
  try {
    const json = JSON.stringify(data);
    if (json.length < COMPRESS_THRESHOLD_BYTES) return data;
    const compressed = LZString.compressToUTF16(json);
    return `\x00lz1\x00${compressed}`;
  } catch {
    return data;
  }
}

export function decompressData<T>(raw: unknown): T {
  if (typeof raw === 'string' && raw.startsWith('\x00lz1\x00')) {
    try {
      const decompressed = LZString.decompressFromUTF16(raw.slice(5));
      return JSON.parse(decompressed ?? '{}') as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
}

// QNBS-v3: Exponential backoff with jitter for transient IDB errors.
// Base delay doubles each attempt (500ms → 1000ms → 2000ms) plus up to 200ms random jitter
// to prevent thundering-herd when multiple tabs retry simultaneously.
export async function retryDb<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : undefined;
      const isTransient =
        name === 'QuotaExceededError' ||
        name === 'InvalidStateError' ||
        name === 'AbortError' ||
        name === 'TransactionInactiveError';
      if (isTransient && attempt < retries) {
        const jitter = Math.floor(Math.random() * 200);
        const delay = baseDelayMs * 2 ** attempt + jitter;
        await new Promise((res) => setTimeout(res, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

export function getUserFriendlyDbError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return 'Browser storage is exhausted. Please delete old projects or snapshots.';
    }
    if (error.name === 'InvalidStateError' || error.name === 'TransactionInactiveError') {
      return 'Internal error accessing the database. Please reload the page.';
    }
    if (error.name === 'AbortError') {
      return 'Database operation was aborted.';
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error accessing the database.';
}

export class IdbConnectionManager {
  protected stateDb: IDBDatabase | null = null;
  protected dataDb: IDBDatabase | null = null;

  protected isStateStore(storeName: string): boolean {
    return storeName === APP_DATA_STORE || storeName === SNAPSHOTS_STORE;
  }

  protected isDataStore(storeName: string): boolean {
    return (
      storeName === IMAGES_STORE ||
      storeName === RAG_VECTORS_STORE ||
      storeName === CODEX_STORE ||
      storeName === BINDER_ASSETS_STORE ||
      storeName === PROJECTS_INDEX_STORE
    );
  }

  private openStateDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(STATE_DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion < 1 && !db.objectStoreNames.contains(APP_DATA_STORE)) {
          db.createObjectStore(APP_DATA_STORE);
        }
        if (event.oldVersion < 2 && !db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
          db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.stateDb = null;
        };
        this.stateDb = db;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private openDataDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATA_DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion < 3 && !db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE);
        }
        if (event.oldVersion < 5 && !db.objectStoreNames.contains(RAG_VECTORS_STORE)) {
          const vectorStore = db.createObjectStore(RAG_VECTORS_STORE, { keyPath: 'id' });
          vectorStore.createIndex('projectId', 'projectId', { unique: false });
          vectorStore.createIndex('type', 'type', { unique: false });
        }
        if (event.oldVersion < 6 && !db.objectStoreNames.contains(CODEX_STORE)) {
          db.createObjectStore(CODEX_STORE, { keyPath: 'projectId' });
        }
        if (event.oldVersion < 7 && !db.objectStoreNames.contains(BINDER_ASSETS_STORE)) {
          db.createObjectStore(BINDER_ASSETS_STORE);
        }
        // QNBS-v3: v8 — privacy-preserving project index for cross-project search (no plaintext content).
        if (event.oldVersion < 8 && !db.objectStoreNames.contains(PROJECTS_INDEX_STORE)) {
          const idx = db.createObjectStore(PROJECTS_INDEX_STORE, { keyPath: 'projectId' });
          idx.createIndex('lastIndexed', 'lastIndexed', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dataDb = null;
        };
        this.dataDb = db;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async initDB(): Promise<void> {
    await Promise.all([this.openStateDb(), this.openDataDb()]);
    if (this.stateDb && this.dataDb) {
      try {
        const result = await migrateLegacyWorldscriptDbIfNeeded(this.stateDb, this.dataDb);
        if (result.migrated) {
          logger.info('Migrated legacy IndexedDB (worldscript-db) to dual-database layout.');
        }
      } catch (error) {
        logger.warn('Legacy IndexedDB migration step failed:', error);
      }
    }
  }

  protected async getObjectStore(
    storeName: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> {
    if (!this.stateDb || !this.dataDb) {
      await this.initDB();
    }
    const targetDb = this.isStateStore(storeName) ? this.stateDb : this.dataDb;
    if (!targetDb || (!this.isStateStore(storeName) && !this.isDataStore(storeName))) {
      throw new Error(`Unknown object store "${storeName}"`);
    }
    const transaction = targetDb.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }
}
