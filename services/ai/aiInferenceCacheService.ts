// QNBS-v3: Two-layer inference cache keeps hot reads in memory while the durable layer is encrypted.
import { logger } from '../logger';
import {
  beginIdbOpenAdmission,
  isIdbOpenStillValid,
  registerIdbConnectionCloser,
} from '../storage/idbResetGate';
import { withProtectedWriteAdmission } from '../storage/protectedWriteAdmission';
import {
  assertSecureStorageReadable,
  assertSecureStorageWritableForMutation,
  prepareSecureRecordPayload,
  readSecureRecordPayload,
  SecureRecordCorruptError,
  type SecureRecordEnvelope,
} from '../storage/storageEncryptionService';

const IN_MEMORY_MAX = 64;
const IDB_MAX_ENTRIES = 256;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SKIP_CACHE_PROMPT_LENGTH = 512;
const IDB_STORE = 'inference-cache';
const IDB_DB_NAME = 'worldscript-inference-cache-db';
const IDB_DB_VERSION = 1;
const SECURE_STORE = `${IDB_DB_NAME}/${IDB_STORE}`;

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

function hashKey(prompt: string, modelId: string): string {
  const input = `${modelId}::${prompt}`;
  let djb2 = 5381;
  let fnv = 2166136261;
  for (let index = 0; index < input.length; index++) {
    const character = input.charCodeAt(index);
    djb2 = ((djb2 << 5) + djb2) ^ character;
    fnv = Math.imul(fnv ^ character, 16777619);
  }
  return `${(djb2 >>> 0).toString(16)}-${(fnv >>> 0).toString(16)}`;
}

function isCachePayload(value: unknown): value is CachePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<CachePayload>).result === 'string'
  );
}

function isCacheEntry(value: unknown): value is CacheEntry | LegacyCacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<CacheEntry & LegacyCacheEntry>;
  return (
    typeof entry.key === 'string' &&
    typeof entry.timestamp === 'number' &&
    ('payload' in entry || typeof entry.result === 'string')
  );
}

export class AiInferenceCacheService {
  private readonly inMemory = new Map<string, LruEntry>();
  private db: IDBDatabase | null = null;
  private openPromise: Promise<void> | null = null;

  constructor() {
    // QNBS-v3 (CodeAnt): this connection is cached for the service's lifetime — a factory reset must close it or deleteDatabase(worldscript-inference-cache-db) blocks. openPromise must clear too, or a post-reset caller reuses the invalidated in-flight open instead of retrying immediately.
    registerIdbConnectionCloser(() => {
      this.db?.close();
      this.db = null;
      this.openPromise = null;
    });
  }

  // QNBS-v3: retryable, not a one-shot constructor-time promise — the original design permanently disabled durable caching for the rest of the session (silently falling back to in-memory-only) if the very first open lost a race with a reset; every caller now re-attempts whenever there's no live connection and no attempt already in flight.
  private ensureDb(): Promise<void> {
    if (this.db) return Promise.resolve();
    if (this.openPromise) return this.openPromise;
    // QNBS-v3 (CodeAnt): identity-checked, not a bare reassignment — the reset closer can null openPromise directly while this open is still in flight, so a later caller starts a second attempt; this settlement must not then clobber that newer attempt's reference.
    const thisOpen: Promise<void> = this.openDb();
    this.openPromise = thisOpen;
    thisOpen.finally(() => {
      if (this.openPromise === thisOpen) this.openPromise = null;
    });
    return thisOpen;
  }

  private openDb(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }
      // QNBS-v3: skips opening entirely if a reset is currently draining — the generation check alone can't catch an open that STARTS mid-reset, since it would capture the reset's own already-bumped generation.
      const openGeneration = beginIdbOpenAdmission();
      if (openGeneration === null) {
        resolve();
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      } catch {
        resolve();
        return;
      }
      if (!request) {
        resolve();
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      request.onsuccess = () => {
        const opened = request.result;
        if (!isIdbOpenStillValid(openGeneration)) {
          opened.close();
          resolve();
          return;
        }
        this.db = opened;
        opened.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        resolve();
      };
      request.onerror = () => resolve();
    });
  }

  private evictLru(): void {
    if (this.inMemory.size < IN_MEMORY_MAX) return;
    let oldestKey = '';
    let oldestTimestamp = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.inMemory) {
      if (entry.lastUsed < oldestTimestamp) {
        oldestTimestamp = entry.lastUsed;
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

  private async decodeEntry(entry: CacheEntry | LegacyCacheEntry): Promise<string> {
    const rawPayload = 'payload' in entry ? entry.payload : { result: entry.result };
    const decoded = await readSecureRecordPayload<CachePayload>(rawPayload, {
      store: SECURE_STORE,
      recordId: entry.key,
      legacyStores: ['inference-cache'],
    });
    if (!isCachePayload(decoded.value)) throw new SecureRecordCorruptError();
    if (decoded.needsMigration) {
      // QNBS-v3: best-effort opportunistic re-encrypt on read — a failure (e.g. an active migration) must never block the read, and the 7-day TTL already bounds residual plaintext exposure even without this.
      void this.reencryptLegacyEntry(entry.key, decoded.value.result, entry.timestamp);
    }
    return decoded.value.result;
  }

  private async reencryptLegacyEntry(
    key: string,
    result: string,
    timestamp: number,
  ): Promise<void> {
    if (!this.db) return;
    try {
      // QNBS-v3: shares the writer-admission lock so this opportunistic write cannot land mid-migration-batch either.
      await withProtectedWriteAdmission(async () => {
        const encoded = await this.encodeEntry(key, result, timestamp);
        await this.persistEntry(encoded);
      });
    } catch {
      // QNBS-v3: best-effort; a failed opportunistic re-encrypt is not user-visible and TTL still bounds exposure.
    }
  }

  private async persistEntry(entry: CacheEntry): Promise<void> {
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      const transaction = this.db!.transaction(IDB_STORE, 'readwrite');
      transaction.objectStore(IDB_STORE).put(entry);
      // QNBS-v3: Cache data is non-authoritative, but lock and migration failures occur before this best-effort write.
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  async getCachedInference(prompt: string, modelId: string): Promise<string | null> {
    if (this.shouldSkip(prompt)) return null;
    const key = hashKey(prompt, modelId);
    try {
      // QNBS-v3: A locked library must not expose an earlier plaintext response through the RAM tier.
      await assertSecureStorageReadable();
    } catch {
      // QNBS-v3: cache is non-authoritative — any lifecycle-check failure (locked, migrating, or the check's own IDB access failing) degrades to a miss rather than failing an otherwise-successful inference call.
      return null;
    }

    const memoryEntry = this.inMemory.get(key);
    if (memoryEntry) {
      memoryEntry.lastUsed = Date.now();
      return memoryEntry.result;
    }

    await this.ensureDb();
    if (!this.db) return null;
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(IDB_STORE, 'readonly');
      const request = transaction.objectStore(IDB_STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result as unknown;
        if (!entry) {
          resolve(null);
          return;
        }
        if (!isCacheEntry(entry)) {
          // QNBS-v3: matches the non-authoritative cache policy above — a malformed row degrades to a miss, never fails the caller's inference request.
          logger.warn('aiInferenceCacheService: dropping a malformed cache row', { key });
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > TTL_MS) {
          resolve(null);
          return;
        }
        void this.decodeEntry(entry).then(
          (result) => {
            this.evictLru();
            this.inMemory.set(key, { result, lastUsed: Date.now() });
            resolve(result);
          },
          (error: unknown) => {
            // QNBS-v3: same non-authoritative policy — a corrupt/undecodable row degrades to a miss instead of failing the caller's inference request.
            logger.warn('aiInferenceCacheService: dropping an undecodable cache row', {
              key,
              error,
            });
            resolve(null);
          },
        );
      };
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    });
  }

  async setCachedInference(prompt: string, modelId: string, result: string): Promise<void> {
    if (this.shouldSkip(prompt)) return;
    const key = hashKey(prompt, modelId);
    this.evictLru();
    this.inMemory.set(key, { result, lastUsed: Date.now() });
    await this.ensureDb();
    if (!this.db) return;
    try {
      // QNBS-v3: shares the writer-admission lock so eviction/persist cannot run mid-migration-batch and produce a false verification shortfall (#338).
      await withProtectedWriteAdmission(async () => {
        const entry = await this.encodeEntry(key, result, Date.now());
        await this.idbEvictOldest();
        await this.persistEntry(entry);
      });
    } catch {
      // QNBS-v3: The encrypted durable cache is non-authoritative; lock or migration state must not fail inference.
    }
  }

  private async idbEvictOldest(): Promise<void> {
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      const transaction = this.db!.transaction(IDB_STORE, 'readwrite');
      const store = transaction.objectStore(IDB_STORE);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const count = countRequest.result;
        if (count < IDB_MAX_ENTRIES) {
          resolve();
          return;
        }
        const cursorRequest = store.index('timestamp').openCursor();
        let remaining = count - IDB_MAX_ENTRIES + 1;
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || remaining <= 0) {
            resolve();
            return;
          }
          cursor.delete();
          remaining--;
          cursor.continue();
        };
        cursorRequest.onerror = () => resolve();
      };
      countRequest.onerror = () => resolve();
    });
  }

  async clearPersistentCache(): Promise<void> {
    await assertSecureStorageWritableForMutation();
    this.inMemory.clear();
    await this.ensureDb();
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      const transaction = this.db!.transaction(IDB_STORE, 'readwrite');
      transaction.objectStore(IDB_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  getInMemorySize(): number {
    return this.inMemory.size;
  }
}

export const aiInferenceCacheService = new AiInferenceCacheService();
