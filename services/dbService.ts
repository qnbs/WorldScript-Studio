import * as LZString from 'lz-string';
import type { ProjectData } from '../features/project/projectSlice';
import type { ProjectSnapshot, Settings, StoryCodex } from '../types';
import { logger } from './logger';

const DB_NAME = 'storycraft-db';
const DB_VERSION = 6; // v6: Story Codex store added
const APP_DATA_STORE = 'app-data-store';
const SNAPSHOTS_STORE = 'snapshots-store';
const IMAGES_STORE = 'images-store';
const RAG_VECTORS_STORE = 'rag-vectors-store';
const CODEX_STORE = 'codex-store';

// LZ-String threshold: compress payloads >10 KB
const COMPRESS_THRESHOLD_BYTES = 10_240;

// Serialize + compress, transparently decompress on read
function compressData<T>(data: T): string | T {
  try {
    const json = JSON.stringify(data);
    if (json.length < COMPRESS_THRESHOLD_BYTES) return data; // small enough, skip
    const compressed = LZString.compressToUTF16(json);
    // prefix so we can identify compressed values
    return `\x00lz1\x00${compressed}`;
  } catch {
    return data;
  }
}

function decompressData<T>(raw: unknown): T {
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

// Secure API Key Storage Records
const GEMINI_API_KEY_RECORD = 'gemini_api_key_encrypted_v1';
const GEMINI_API_KEY_IV_RECORD = 'gemini_api_key_iv_v1';
const CRYPTO_KEY_RECORD = 'local_crypto_key_v2';

// Define structure of state stored in DB
interface PersistedProjectState {
  // Redux-undo shape for present state, or full undoable envelope
  data?: ProjectData; // Flattened structure often saved
  present?: { data: ProjectData }; // Structure if full slice saved
}

interface PersistedState {
  project?: PersistedProjectState;
  settings?: Settings;
}

// Hilfsfunktion für Retry bei IndexedDB
async function retryDb<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      // Nur bei temporären Fehlern erneut versuchen
      const name = err instanceof DOMException ? err.name : undefined;
      if (
        name === 'QuotaExceededError' ||
        name === 'InvalidStateError' ||
        name === 'AbortError' ||
        name === 'TransactionInactiveError'
      ) {
        if (attempt < retries) await new Promise((res) => setTimeout(res, delayMs));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

function getUserFriendlyDbError(error: unknown): string {
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

class IndexedDBService {
  private db: IDBDatabase | null = null;
  private lastAutoSnapshotTime = Date.now();
  private readonly AUTO_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_AUTO_SNAPSHOTS = 20;

  // === CRYPTO HELPERS für API Key Verschlüsselung ===

  /** Legacy key derivation — used only for migrating existing encrypted data. */
  private async getLegacyCryptoKey(): Promise<CryptoKey> {
    const material = new TextEncoder().encode(
      `${location.origin}|StoryCraftStudio|gemini-key-v1|${navigator.userAgent.slice(0, 50)}`,
    );
    const hash = await crypto.subtle.digest('SHA-256', material);
    return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /**
   * Get or create a random non-extractable CryptoKey stored in IndexedDB.
   * On first call a new key is generated and persisted; subsequent calls
   * return the stored key via structured-clone.
   */
  private async getLocalCryptoKey(): Promise<CryptoKey> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const req = store.get(CRYPTO_KEY_RECORD);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(getUserFriendlyDbError(req.error));
    });
    if (existing) return existing;

    // Generate a new random non-extractable key
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);

    const writeStore = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = writeStore.put(key, CRYPTO_KEY_RECORD);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(getUserFriendlyDbError(req.error));
    });

    return key;
  }

  /**
   * Decrypt data, falling back to the legacy derived key for migration.
   * If the legacy key succeeds, re-encrypts with the new stored key.
   */
  private async decryptWithMigration(
    encrypted: Uint8Array,
    iv: Uint8Array,
    reEncryptRecordKey: string,
    reEncryptIvKey: string,
  ): Promise<string> {
    const newKey = await this.getLocalCryptoKey();
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
        newKey,
        encrypted as Uint8Array<ArrayBuffer>,
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      // Try legacy key for migration
      const legacyKey = await this.getLegacyCryptoKey();
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
        legacyKey,
        encrypted as Uint8Array<ArrayBuffer>,
      );
      const plaintext = new TextDecoder().decode(decrypted);

      // Re-encrypt with the new key
      const newIv = crypto.getRandomValues(new Uint8Array(12));
      const reEncrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: newIv },
        newKey,
        new TextEncoder().encode(plaintext),
      );
      const ws = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const r1 = ws.put(Array.from(new Uint8Array(reEncrypted)), reEncryptRecordKey);
        const r2 = ws.put(Array.from(newIv), reEncryptIvKey);
        let done = 0;
        const ok = () => {
          done++;
          if (done === 2) resolve();
        };
        r1.onsuccess = ok;
        r2.onsuccess = ok;
        r1.onerror = () => reject(getUserFriendlyDbError(r1.error));
        r2.onerror = () => reject(getUserFriendlyDbError(r2.error));
      });

      return plaintext;
    }
  }

  async saveGeminiApiKey(apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }
    return retryDb(async () => {
      const cryptoKey = await this.getLocalCryptoKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedKey = new TextEncoder().encode(apiKey.trim());
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encodedKey);
      const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      return new Promise((resolve, reject) => {
        const encryptedArray = Array.from(new Uint8Array(encrypted));
        const ivArray = Array.from(iv);
        const req1 = store.put(encryptedArray, GEMINI_API_KEY_RECORD);
        const req2 = store.put(ivArray, GEMINI_API_KEY_IV_RECORD);
        let completed = 0;
        const onSuccess = () => {
          completed++;
          if (completed === 2) resolve();
        };
        req1.onsuccess = onSuccess;
        req2.onsuccess = onSuccess;
        req1.onerror = () => reject(getUserFriendlyDbError(req1.error));
        req2.onerror = () => reject(getUserFriendlyDbError(req2.error));
      });
    });
  }

  async getGeminiApiKey(): Promise<string | null> {
    return retryDb(async () => {
      try {
        const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
        const [encryptedArray, ivArray] = await Promise.all([
          new Promise<number[] | undefined>((resolve, reject) => {
            const req = store.get(GEMINI_API_KEY_RECORD);
            req.onsuccess = () => resolve(req.result as number[] | undefined);
            req.onerror = () => reject(getUserFriendlyDbError(req.error));
          }),
          new Promise<number[] | undefined>((resolve, reject) => {
            const req = store.get(GEMINI_API_KEY_IV_RECORD);
            req.onsuccess = () => resolve(req.result as number[] | undefined);
            req.onerror = () => reject(getUserFriendlyDbError(req.error));
          }),
        ]);
        if (!encryptedArray || !ivArray) {
          return null;
        }
        return await this.decryptWithMigration(
          new Uint8Array(encryptedArray),
          new Uint8Array(ivArray),
          GEMINI_API_KEY_RECORD,
          GEMINI_API_KEY_IV_RECORD,
        );
      } catch (error) {
        logger.warn('Failed to decrypt API key:', error);
        return null;
      }
    });
  }

  async hasGeminiApiKey(): Promise<boolean> {
    const key = await this.getGeminiApiKey();
    return Boolean(key && key.length > 0);
  }

  async clearGeminiApiKey(): Promise<void> {
    return retryDb(async () => {
      const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      return new Promise((resolve, reject) => {
        const req1 = store.delete(GEMINI_API_KEY_RECORD);
        const req2 = store.delete(GEMINI_API_KEY_IV_RECORD);
        let completed = 0;
        const onSuccess = () => {
          completed++;
          if (completed === 2) resolve();
        };
        req1.onsuccess = onSuccess;
        req2.onsuccess = onSuccess;
        req1.onerror = () => reject(getUserFriendlyDbError(req1.error));
        req2.onerror = () => reject(getUserFriendlyDbError(req2.error));
      });
    });
  }

  // === GENERIC PROVIDER API KEY STORAGE ===
  // Uses same encryption pattern as Gemini key, keyed by provider name.

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey?.trim()) throw new Error('API key cannot be empty');
    return retryDb(async () => {
      const cryptoKey = await this.getLocalCryptoKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(apiKey.trim());
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
      const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      return new Promise((resolve, reject) => {
        const r1 = store.put(Array.from(new Uint8Array(encrypted)), `api_key_${provider}_enc`);
        const r2 = store.put(Array.from(iv), `api_key_${provider}_iv`);
        let done = 0;
        const ok = () => {
          done++;
          if (done === 2) resolve();
        };
        r1.onsuccess = ok;
        r2.onsuccess = ok;
        r1.onerror = () => reject(getUserFriendlyDbError(r1.error));
        r2.onerror = () => reject(getUserFriendlyDbError(r2.error));
      });
    });
  }

  async getApiKey(provider: string): Promise<string | null> {
    return retryDb(async () => {
      try {
        const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
        const [encArr, ivArr] = await Promise.all([
          new Promise<number[] | undefined>((res, rej) => {
            const r = store.get(`api_key_${provider}_enc`);
            r.onsuccess = () => res(r.result as number[] | undefined);
            r.onerror = () => rej(getUserFriendlyDbError(r.error));
          }),
          new Promise<number[] | undefined>((res, rej) => {
            const r = store.get(`api_key_${provider}_iv`);
            r.onsuccess = () => res(r.result as number[] | undefined);
            r.onerror = () => rej(getUserFriendlyDbError(r.error));
          }),
        ]);
        if (!encArr || !ivArr) return null;
        return await this.decryptWithMigration(
          new Uint8Array(encArr),
          new Uint8Array(ivArr),
          `api_key_${provider}_enc`,
          `api_key_${provider}_iv`,
        );
      } catch (err) {
        // Distinguish between "no key stored" vs "decryption failed" (e.g. device change, cleared site data)
        logger.warn(`API key decryption failed for provider "${provider}":`, err);
        return null;
      }
    });
  }

  async clearApiKey(provider: string): Promise<void> {
    return retryDb(async () => {
      const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
      return new Promise<void>((resolve, reject) => {
        const r1 = store.delete(`api_key_${provider}_enc`);
        const r2 = store.delete(`api_key_${provider}_iv`);
        let done = 0;
        const ok = () => {
          done++;
          if (done === 2) resolve();
        };
        r1.onsuccess = ok;
        r2.onsuccess = ok;
        r1.onerror = () => reject(getUserFriendlyDbError(r1.error));
        r2.onerror = () => reject(getUserFriendlyDbError(r2.error));
      });
    });
  }

  // === EXISTING DB METHODS ===

  async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        // v1: Basis-Store
        if (event.oldVersion < 1) {
          if (!db.objectStoreNames.contains(APP_DATA_STORE)) {
            db.createObjectStore(APP_DATA_STORE);
          }
        }
        // v2: Snapshot-Store
        if (event.oldVersion < 2) {
          if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
            db.createObjectStore(SNAPSHOTS_STORE, {
              keyPath: 'id',
              autoIncrement: true,
            });
          }
        }
        // v3: Bilder-Store
        if (event.oldVersion < 3) {
          if (!db.objectStoreNames.contains(IMAGES_STORE)) {
            db.createObjectStore(IMAGES_STORE);
          }
        }
        // v4: API-Key-Verschlüsselung (kein neuer Store – Daten in APP_DATA_STORE)
        // v5: RAG-Vektoren-Store für Konsistenzprüfung & semantische Suche
        if (event.oldVersion < 5) {
          if (!db.objectStoreNames.contains(RAG_VECTORS_STORE)) {
            const vectorStore = db.createObjectStore(RAG_VECTORS_STORE, {
              keyPath: 'id',
            });
            vectorStore.createIndex('projectId', 'projectId', {
              unique: false,
            });
            vectorStore.createIndex('type', 'type', { unique: false });
          }
        }
        // v6: Story Codex store für automatische Entitätenextraktion
        if (event.oldVersion < 6) {
          if (!db.objectStoreNames.contains(CODEX_STORE)) {
            db.createObjectStore(CODEX_STORE, {
              keyPath: 'projectId',
            });
          }
        }
      };

      // Verbindungs-Abbruch bei versionchange (anderer Tab öffnet neue Version)
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.db = null;
          logger.warn(
            'IndexedDB: Database version changed – connection closed. Please reload the page.',
          );
        };
        this.db = db;
        resolve();
      };

      request.onerror = () => {
        logger.error('IndexedDB error:', request.error);
        reject(request.error);
      };
    });
  }

  private async getObjectStore(
    storeName: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> {
    if (!this.db) {
      await this.initDB();
    }
    const transaction = this.db!.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  async saveSlice(
    sliceName: 'project' | 'settings',
    data: PersistedProjectState | Settings,
  ): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    // Compress large state objects (project data can exceed 100 KB)
    const payload = compressData(data);
    return new Promise((resolve, reject) => {
      const request = store.put(payload, sliceName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Helper methods for explicit saving
  async saveProject(data: PersistedProjectState): Promise<void> {
    // Check auto-snapshot condition during save
    if (Date.now() - this.lastAutoSnapshotTime > this.AUTO_SNAPSHOT_INTERVAL) {
      // We need to extract just the data part if it's the full redux state
      const projectData = data.present ? data.present.data : data.data;
      if (projectData?.manuscript) {
        this.lastAutoSnapshotTime = Date.now();
        // Fire and forget snapshot to not block UI
        this.createSnapshot(projectData).then(() => this.pruneAutoSnapshots());
      }
    }
    return this.saveSlice('project', data);
  }

  async saveSettings(data: Settings): Promise<void> {
    return this.saveSlice('settings', data);
  }

  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
    const payload = compressData(codex);
    return new Promise((resolve, reject) => {
      const request = store.put(payload, codex.projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    const store = await this.getObjectStore(CODEX_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(projectId);
      request.onsuccess = () => {
        const raw = request.result;
        if (!raw) {
          resolve(null);
          return;
        }
        resolve(decompressData<StoryCodex>(raw));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    const store = await this.getObjectStore(CODEX_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(projectId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Helper to validate state structure and fix common issues
  private validateAndFixState(project: unknown, settings: unknown): PersistedState | undefined {
    // If project is missing but we have settings, return partial to allow new user flow
    if (!project && !settings) return undefined;

    const validProject = project ? (project as PersistedProjectState) : undefined;

    // Ensure Project Structure consistency
    if (validProject) {
      const rawData = validProject.present ? validProject.present.data : validProject.data;
      if (rawData) {
        // Ensure projectGoals exists
        if (!rawData.projectGoals) {
          rawData.projectGoals = { totalWordCount: 50000, targetDate: null };
        }
        // Ensure writingHistory exists
        if (!rawData.writingHistory) {
          rawData.writingHistory = [];
        }
      }
    }

    // Ensure settings has defaults if missing keys
    let validSettings: Settings | undefined;
    if (settings) {
      const incoming = settings as Record<string, unknown>;
      validSettings = {
        theme: 'dark',
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.6,
        aiCreativity: 'Balanced',
        paragraphSpacing: 1,
        indentFirstLine: false,
        ...incoming,
      } as Settings;
    }

    const result: PersistedState = {};
    if (validProject) result.project = validProject;
    if (validSettings) result.settings = validSettings;
    return result;
  }

  async loadState(): Promise<PersistedState | undefined> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    const projectRequest = store.get('project');
    const settingsRequest = store.get('settings');

    return new Promise((resolve, reject) => {
      let project: unknown;
      let settings: unknown;
      let completed = 0;

      const onComplete = () => {
        if (++completed === 2) {
          const validated = this.validateAndFixState(project, settings);
          resolve(validated);
        }
      };

      projectRequest.onsuccess = () => {
        project = decompressData(projectRequest.result);
        onComplete();
      };
      settingsRequest.onsuccess = () => {
        settings = decompressData(settingsRequest.result);
        onComplete();
      };

      projectRequest.onerror = () => reject(projectRequest.error);
      settingsRequest.onerror = () => reject(settingsRequest.error);
    });
  }

  async hasSavedData(): Promise<boolean> {
    try {
      const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
      const request = store.count();
      return new Promise((resolve) => {
        request.onsuccess = () => {
          resolve(request.result > 0);
        };
        request.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  // --- Image Store Methods ---
  async saveImage(id: string, base64: string): Promise<void> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(base64, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getImage(id: string): Promise<string | null> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteImage(id: string): Promise<void> {
    const store = await this.getObjectStore(IMAGES_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Snapshot Methods ---

  async createSnapshot(data: ProjectData, name?: string): Promise<number> {
    const wordCount = data.manuscript.reduce(
      (sum, section) => sum + (section.content?.split(/\s+/).filter(Boolean).length || 0),
      0,
    );
    const snapshotData = {
      date: new Date().toISOString(),
      name: name || 'Automatic Snapshot',
      wordCount,
      // Compress snapshot payload – snapshots can be very large
      data: compressData(data),
    };

    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.add(snapshotData);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSnapshot(name: string, data: ProjectData): Promise<number> {
    return this.createSnapshot(data, name);
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readonly');
    // IDBKeyRange: iterate in reverse (newest first) using cursor direction 'prev'
    const request = store.openCursor(null, 'prev');
    const snapshots: ProjectSnapshot[] = [];

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const { data: _data, ...metadata } = cursor.value;
          snapshots.push({ id: cursor.key as number, ...metadata });
          cursor.continue();
        } else {
          resolve(snapshots);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSnapshotData(id: number): Promise<ProjectData> {
    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const raw = request.result?.data;
        resolve(decompressData<ProjectData>(raw));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSnapshot(id: number): Promise<void> {
    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async pruneAutoSnapshots(): Promise<void> {
    const store = await this.getObjectStore(SNAPSHOTS_STORE, 'readwrite');
    // Use IDBKeyRange to get all keys efficiently (no full data fetch needed)
    const allKeys: number[] = await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result as number[]);
      req.onerror = () => reject(req.error);
    });

    if (allKeys.length <= this.MAX_AUTO_SNAPSHOTS) return;

    // Keys are auto-increment ints → oldest first; delete oldest excess
    const toDelete = allKeys
      .sort((a, b) => a - b)
      .slice(0, allKeys.length - this.MAX_AUTO_SNAPSHOTS);

    for (const key of toDelete) {
      await this.deleteSnapshot(key);
    }
  }
}

export const dbService = new IndexedDBService();
