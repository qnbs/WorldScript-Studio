// QNBS-v3: In-memory dead-letter queue with best-effort IDB persistence.
//          Stores failed tasks for operator inspection. Not a retry queue.

import { createLogger } from '../../../services/logger';
import { DEAD_LETTER_CAPACITY } from './constants';
import type { TaskResult, WorkerTask } from './types';

const log = createLogger('worker-bus:dlq');
const IDB_DB_NAME = 'storycraft-dead-letter-db';
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

function openDlqDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
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
