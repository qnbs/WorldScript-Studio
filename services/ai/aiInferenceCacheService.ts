// QNBS-v3: Two-layer inference cache — in-memory LRU for hot paths, IndexedDB for persistence.
//          Adapted from CannaGuide-2025 cacheService.ts patterns for WorldScript creative context.

const IN_MEMORY_MAX = 64;
const IDB_MAX_ENTRIES = 256;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// QNBS-v3: Skip caching for long prompts — they're likely unique streaming contexts.
const SKIP_CACHE_PROMPT_LENGTH = 512;
const IDB_STORE = 'inference-cache';
const IDB_DB_NAME = 'worldscript-inference-cache-db';
const IDB_DB_VERSION = 1;

interface CacheEntry {
  key: string;
  result: string;
  timestamp: number;
}

interface LruEntry {
  result: string;
  lastUsed: number;
}

// QNBS-v3: DJB2 + FNV hash combination for fast, low-collision prompt keys.
function hashKey(prompt: string, modelId: string): string {
  const input = `${modelId}::${prompt}`;
  let djb2 = 5381;
  let fnv = 2166136261;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    djb2 = ((djb2 << 5) + djb2) ^ c;
    fnv = Math.imul(fnv ^ c, 16777619);
  }
  return `${(djb2 >>> 0).toString(16)}-${(fnv >>> 0).toString(16)}`;
}

class AiInferenceCacheService {
  private readonly inMemory = new Map<string, LruEntry>();
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;

  constructor() {
    this.dbReady = this.openDb();
  }

  private openDb(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(); // test environment without IDB — graceful degrade
        return;
      }
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      } catch {
        resolve(); // private-browsing mode / jsdom stub — graceful degrade
        return;
      }
      // QNBS-v3: jsdom defines indexedDB but open() returns undefined — guard prevents crash.
      if (!req) {
        resolve();
        return;
      }
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };
      req.onerror = () => resolve(); // degrade gracefully
    });
  }

  private evictLru(): void {
    if (this.inMemory.size < IN_MEMORY_MAX) return;
    let oldestKey = '';
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.inMemory) {
      if (entry.lastUsed < oldestTs) {
        oldestTs = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) this.inMemory.delete(oldestKey);
  }

  private shouldSkip(prompt: string): boolean {
    return prompt.length > SKIP_CACHE_PROMPT_LENGTH;
  }

  async getCachedInference(prompt: string, modelId: string): Promise<string | null> {
    if (this.shouldSkip(prompt)) return null;
    const key = hashKey(prompt, modelId);

    // 1. In-memory check (hot path)
    const mem = this.inMemory.get(key);
    if (mem) {
      mem.lastUsed = Date.now();
      return mem.result;
    }

    // 2. IDB check
    await this.dbReady;
    if (!this.db) return null;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = (e) => {
        const entry = (e.target as IDBRequest<CacheEntry | undefined>).result;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > TTL_MS) {
          resolve(null);
          return;
        }
        // Populate in-memory from IDB hit
        this.evictLru();
        this.inMemory.set(key, { result: entry.result, lastUsed: Date.now() });
        resolve(entry.result);
      };
      req.onerror = () => resolve(null);
    });
  }

  async setCachedInference(prompt: string, modelId: string, result: string): Promise<void> {
    if (this.shouldSkip(prompt)) return;
    const key = hashKey(prompt, modelId);

    // Store in-memory
    this.evictLru();
    this.inMemory.set(key, { result, lastUsed: Date.now() });

    // Persist to IDB
    await this.dbReady;
    if (!this.db) return;
    await this.idbEvictOldest();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE, 'readwrite');
      const entry: CacheEntry = { key, result, timestamp: Date.now() };
      tx.objectStore(IDB_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  private async idbEvictOldest(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const count = countReq.result;
        if (count < IDB_MAX_ENTRIES) {
          resolve();
          return;
        }
        // Evict oldest by timestamp index
        const idx = store.index('timestamp');
        const cursorReq = idx.openCursor();
        let toDelete = count - IDB_MAX_ENTRIES + 1;
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor || toDelete <= 0) {
            resolve();
            return;
          }
          cursor.delete();
          toDelete--;
          cursor.continue();
        };
        cursorReq.onerror = () => resolve();
      };
      countReq.onerror = () => resolve();
    });
  }

  async clearPersistentCache(): Promise<void> {
    this.inMemory.clear();
    await this.dbReady;
    if (!this.db) return;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // QNBS-v3: Exposed for tests to verify in-memory state without IDB.
  getInMemorySize(): number {
    return this.inMemory.size;
  }
}

export const aiInferenceCacheService = new AiInferenceCacheService();
