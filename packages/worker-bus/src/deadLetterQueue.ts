// QNBS-v3: In-memory dead-letter queue with best-effort IDB persistence.
//          Stores failed tasks for operator inspection. Not a retry queue.

import { createLogger } from '../../../services/logger';
import {
  isIdbResetInProgress,
  registerIdbConnectionCloser,
} from '../../../services/storage/idbResetGate';
import { DEAD_LETTER_CAPACITY } from './constants';
import type { TaskResult, WorkerTask } from './types';

const log = createLogger('worker-bus:dlq');
const IDB_DB_NAME = 'worldscript-dead-letter-db';
const IDB_STORE = 'dead_letters';

export interface DeadLetterEntry {
  readonly task: WorkerTask;
  readonly result: TaskResult;
  readonly retryCount: number;
  readonly deadAt: number;
}

export class DeadLetterQueue {
  private entries: DeadLetterEntry[] = [];

  constructor(private readonly capacity = DEAD_LETTER_CAPACITY) {}

  add(entry: DeadLetterEntry): void {
    if (this.entries.length >= this.capacity) {
      this.entries.shift(); // FIFO eviction
    }
    this.entries.push(entry);
    // QNBS-v3: fire-and-forget persistence; never block the hot path
    this.persist().catch(() => {
      /* silent — DLQ is best-effort */
    });
  }

  list(): readonly DeadLetterEntry[] {
    return this.entries;
  }

  count(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }

  private async persist(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await openDlqDb();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      await storeClear(store);
      for (const e of this.entries) {
        store.add(e);
      }
    } catch (err) {
      log.warn('DLQ persist failed', err);
    }
  }

  async load(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await openDlqDb();
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const all = await storeGetAll(store);
      // Sort by deadAt descending, keep newest up to capacity
      const sorted = (all as DeadLetterEntry[]).sort((a, b) => b.deadAt - a.deadAt);
      this.entries = sorted.slice(0, this.capacity);
    } catch (err) {
      log.warn('DLQ load failed', err);
    }
  }
}

let database: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

// QNBS-v3: each call previously opened its own never-closed connection — now cached single-flight so a factory reset has exactly one connection to close instead of none it can reference.
registerIdbConnectionCloser(() => {
  database?.close();
  database = null;
});

function openDlqDb(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      openPromise = null;
      // QNBS-v3: this open may have started before a factory reset began — never cache a connection reset already closed.
      if (isIdbResetInProgress()) {
        db.close();
        reject(new Error('IndexedDB reset in progress'));
        return;
      }
      database = db;
      resolve(db);
    };
    req.onerror = (e) => {
      openPromise = null;
      reject((e.target as IDBOpenDBRequest).error);
    };
  });
  return openPromise;
}

function storeClear(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function storeGetAll(store: IDBObjectStore): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
