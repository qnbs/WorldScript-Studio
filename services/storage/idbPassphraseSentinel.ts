/**
 * idbPassphraseSentinel — persists the passphrase verification token for IDB at-rest encryption.
 * QNBS-v3: Kept as a standalone module (not part of the IdbKeyStore chain) to avoid circular
 * imports — storageEncryptionService.ts imports from here, and the key-store chain imports
 * from storageEncryptionService.ts.
 */

import { APP_DATA_STORE } from '../dbConstants';
import { getUserFriendlyDbError, IdbConnectionManager } from './idbCore';

const SENTINEL_RECORD_KEY = 'idb_passphrase_sentinel_v1';

// QNBS-v3: Minimal subclass to gain protected getObjectStore() access; no extra methods needed.
class PassphraseSentinelStore extends IdbConnectionManager {}

const _store = new PassphraseSentinelStore();

/** Persist the encrypted sentinel bytes (produced by AES-GCM encrypt). */
export async function savePassphraseSentinel(bytes: Uint8Array): Promise<void> {
  const store = await _store.getObjectStore(APP_DATA_STORE, 'readwrite');
  return new Promise<void>((resolve, reject) => {
    const req = store.put(Array.from(bytes), SENTINEL_RECORD_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(getUserFriendlyDbError(req.error));
  });
}

/** Read back the sentinel bytes, or null if none have been saved yet. */
export async function getPassphraseSentinel(): Promise<Uint8Array | null> {
  const store = await _store.getObjectStore(APP_DATA_STORE, 'readonly');
  return new Promise<Uint8Array | null>((resolve, reject) => {
    const req = store.get(SENTINEL_RECORD_KEY);
    req.onsuccess = () => {
      const result = req.result as number[] | undefined;
      resolve(result ? new Uint8Array(result) : null);
    };
    req.onerror = () => reject(getUserFriendlyDbError(req.error));
  });
}

/** Remove the sentinel (called when disabling encryption). */
export async function deletePassphraseSentinel(): Promise<void> {
  const store = await _store.getObjectStore(APP_DATA_STORE, 'readwrite');
  return new Promise<void>((resolve, reject) => {
    const req = store.delete(SENTINEL_RECORD_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(getUserFriendlyDbError(req.error));
  });
}
