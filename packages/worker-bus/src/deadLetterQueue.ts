// QNBS-v3: In-memory dead-letter queue with best-effort IDB persistence.
//          Stores failed tasks for operator inspection. Not a retry queue.

import { createLogger } from '../../../services/logger';
import {
  beginIdbOpenAdmission,
  isIdbOpenStillValid,
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
  // QNBS-v3: rejects immediately if a reset is currently draining — the generation check alone can't catch an open that STARTS mid-reset, since it would capture the reset's own already-bumped generation.
  const openGeneration = beginIdbOpenAdmission();
  if (openGeneration === null) {
    return Promise.reject(new Error('IndexedDB reset in progress'));
  }
  // QNBS-v3: identity token — a stale open's completion must only clear openPromise if it's STILL the current in-flight promise, not a newer one started after a reset closer invalidated this one mid-flight.
  const thisOpen: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (openPromise === thisOpen) openPromise = null;
        if (!isIdbOpenStillValid(openGeneration)) {
          db.close();
          reject(new Error('IndexedDB reset in progress'));
          return;
        }
        // QNBS-v3: another tab's factory reset (or any other deleteDatabase caller) fires versionchange here — close and invalidate so the next call re-opens fresh instead of blocking that deletion.
        db.onversionchange = () => {
          db.close();
          database = null;
        };
        database = db;
        resolve(db);
      };
      req.onerror = (e) => {
        if (openPromise === thisOpen) openPromise = null;
        reject((e.target as IDBOpenDBRequest).error);
      };
    } catch (error) {
      // QNBS-v3: indexedDB.open() itself can throw synchronously (private/restricted mode) — without this, the handlers above never attach, so openPromise would stay memoized as a permanently-rejected promise and DLQ persistence could never retry.
      openPromise = null;
      reject(error);
    }
  });
  openPromise = thisOpen;
  return thisOpen;
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
