/**
 * IdbKeyStore — AES-256-GCM API key encryption / decryption.
 * ENCRYPTION: AES-256-GCM via non-extractable CryptoKey (SEC-RULE-5 compliant).
 * QNBS-v3: Extracted from dbService.ts — only this module touches raw key material.
 */

import { APP_DATA_STORE } from '../dbConstants';
import { logger } from '../logger';
import { getUserFriendlyDbError, IdbConnectionManager, retryDb } from './idbCore';

const GEMINI_API_KEY_RECORD = 'gemini_api_key_encrypted_v1';
const GEMINI_API_KEY_IV_RECORD = 'gemini_api_key_iv_v1';
const CRYPTO_KEY_RECORD = 'local_crypto_key_v2';

export class IdbKeyStore extends IdbConnectionManager {
  /** Legacy key derivation — used only for migrating existing encrypted data. */
  private async getLegacyCryptoKey(): Promise<CryptoKey> {
    const material = new TextEncoder().encode(
      `${location.origin}|WorldScriptStudio|gemini-key-v1|${navigator.userAgent.slice(0, 50)}`,
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

  /** Expose the local non-extractable CryptoKey for callers that need to encrypt before writing to DuckDB. */
  async getCryptoKey(): Promise<CryptoKey> {
    return this.getLocalCryptoKey();
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
}
