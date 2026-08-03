// QNBS-v3: Two-layer inference cache — in-memory LRU for hot paths, IndexedDB for persistence.
//          Adapted from CannaGuide-2025 cacheService.ts patterns for WorldScript creative context.
import {
  assertSecureStorageWritableForMutation,
  prepareSecureRecordPayload,
  prepareSecureRecordPayloadWithKey,
  readSecureRecordPayload,
  reEncryptSecureRecordEnvelope,
  SecureRecordCorruptError,
  type SecureRecordEnvelope,
} from '../storage/storageEncryptionService';

const SECURE_STORE = 'inference-cache';
const IN_MEMORY_MAX = 64;
const IDB_MAX_ENTRIES = 256;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// QNBS-v3: Skip caching for long prompts — they're likely unique streaming contexts.
const SKIP_CACHE_PROMPT_LENGTH = 512;
const IDB_STORE = 'inference-cache';
const IDB_DB_NAME = 'worldscript-inference-cache-db';
const IDB_DB_VERSION = 1;

interface LegacyCacheEntry {
  key: string;
  result: string;
  timestamp: number;
}

interface CachePayload {
  result: string;
}

interface CacheEntry {
  key: string;
  timestamp: number;
  payload: CachePayload | SecureRecordEnvelope;
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

export class AiInferenceCacheService {
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

  private async encodeEntry(key: string, result: string, timestamp: number): Promise<CacheEntry> {
    return {
      key,
      timestamp,
      payload: await prepareSecureRecordPayload<CachePayload>(
        { result },
        {
          store: SECURE_STORE,
          recordId: key,
        },
      ),
    };
  }

  private async decodeEntry(
    stored: CacheEntry | LegacyCacheEntry,
  ): Promise<{ result: string; needsMigration: boolean }> {
    const recordId = stored.key;
    const rawPayload = 'payload' in stored ? stored.payload : { result: stored.result };
    const decoded = await readSecureRecordPayload<CachePayload>(rawPayload, {
      store: SECURE_STORE,
      recordId,
    });
    if (typeof decoded.value?.result !== 'string') throw new SecureRecordCorruptError();
    return { result: decoded.value.result, needsMigration: decoded.needsMigration };
  }

  private async persistEntry(entry: CacheEntry): Promise<void> {
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      const transaction = this.db!.transaction(IDB_STORE, 'readwrite');
      transaction.objectStore(IDB_STORE).put(entry);
      // QNBS-v3: Cache persistence remains best-effort; encryption/locked errors happen before this transaction.
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
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
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = (e) => {
        const entry = (e.target as IDBRequest<CacheEntry | LegacyCacheEntry | undefined>).result;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > TTL_MS) {
          resolve(null);
          return;
        }
        void (async () => {
          const decoded = await this.decodeEntry(entry);
          if (decoded.needsMigration) {
            await this.persistEntry(await this.encodeEntry(key, decoded.result, entry.timestamp));
          }
          this.evictLru();
          this.inMemory.set(key, { result: decoded.result, lastUsed: Date.now() });
          return decoded.result;
        })().then(resolve, reject);
      };
      req.onerror = () => resolve(null);
    });
  }

  async setCachedInference(prompt: string, modelId: string, result: string): Promise<void> {
    if (this.shouldSkip(prompt)) return;
    const key = hashKey(prompt, modelId);

    await this.dbReady;
    if (!this.db) {
      this.evictLru();
      this.inMemory.set(key, { result, lastUsed: Date.now() });
      return;
    }
    // QNBS-v3: Encrypt before mutating either cache layer so a locked persistent cache fails atomically.
    const entry = await this.encodeEntry(key, result, Date.now());
    this.evictLru();
    this.inMemory.set(key, { result, lastUsed: Date.now() });
    await this.idbEvictOldest();
    await this.persistEntry(entry);
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
    await assertSecureStorageWritableForMutation();
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

async function openInferenceCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Decrypt all cache payloads to plaintext before encryption is disabled. */
export async function migrateAiInferenceCacheForDisable(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openInferenceCacheDb();
  const raw = await new Promise<Array<CacheEntry | LegacyCacheEntry>>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result as Array<CacheEntry | LegacyCacheEntry>);
    req.onerror = () => reject(req.error);
  });
  const plaintext: Array<{ key: string; timestamp: number; payload: CachePayload }> = [];
  for (const stored of raw) {
    const recordId = stored.key;
    const rawPayload = 'payload' in stored ? stored.payload : { result: stored.result };
    const decoded = await readSecureRecordPayload<CachePayload>(rawPayload, {
      store: SECURE_STORE,
      recordId,
    });
    plaintext.push({
      key: stored.key,
      timestamp: stored.timestamp,
      payload: { result: decoded.value.result },
    });
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (const entry of plaintext) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Re-encrypt all cache payloads during passphrase rotation. */
export async function reEncryptAiInferenceCache(
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openInferenceCacheDb();
  const raw = await new Promise<CacheEntry[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result as CacheEntry[]);
    req.onerror = () => reject(req.error);
  });
  const migrated: CacheEntry[] = [];
  for (const stored of raw) {
    const context = { store: SECURE_STORE, recordId: stored.key };
    const payload =
      stored.payload && typeof stored.payload === 'object' && 'ciphertext' in stored.payload
        ? await reEncryptSecureRecordEnvelope(
            stored.payload as SecureRecordEnvelope,
            context,
            oldKey,
            newKey,
          )
        : await prepareSecureRecordPayloadWithKey(stored.payload as CachePayload, context, newKey);
    migrated.push({ ...stored, payload });
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (const entry of migrated) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
