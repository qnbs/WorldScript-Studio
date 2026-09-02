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
        reject((e.target as IDBOpenDBRequest).error);
      };
    } catch (error) {
      // QNBS-v3: indexedDB.open() itself can throw synchronously (private/restricted mode) — the .finally() below is what actually clears openPromise; clearing it here would just be overwritten by the unconditional assignment two lines down.
      reject(error);
    }
  });
  openPromise = thisOpen;
  // QNBS-v3: single ownership-checked cleanup for every settlement (success, async onerror, reset-invalidation reject, AND a synchronous open throw) — .finally()'s callback always runs as a later microtask, so this always sees openPromise already set to thisOpen, even when the promise settled synchronously above. The trailing .catch(() => {}) is only to prevent an unhandled-rejection warning on this DISCARDED derived chain — thisOpen itself is returned separately and its rejection is handled by the actual caller.
  thisOpen
    .finally(() => {
      if (openPromise === thisOpen) openPromise = null;
    })
    .catch(() => {});
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
