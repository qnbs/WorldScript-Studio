/**
 * StorageEncryptionService — AES-256-GCM at-rest encryption for IDB stores.
 * ENCRYPTION: AES-256-GCM, PBKDF2-SHA-256 (600k iterations, OWASP 2024 minimum), non-extractable key (SEC-RULE-5).
 * QNBS-v3: Phase 2 B-1. Key held in-memory only; never serialised; cleared by clearIdbEncryptionKey().
 *          Salt is non-secret (prevents cross-install rainbow tables); stored in localStorage.
 *
 * Passphrase sentinel (added for correct opt-in behaviour):
 *   A small AES-GCM encrypted token is persisted in IDB (via idbPassphraseSentinel) the first
 *   time the user sets up encryption. On every subsequent app start the sentinel is decrypted
 *   with the derived key — AES-GCM's auth-tag guarantees a wrong passphrase throws immediately.
 *   If no sentinel exists the feature flag is silently cleared (App.tsx startup guard).
 */

import { decompressData } from './idbCore';
import {
  deletePassphraseSentinel,
  getPassphraseSentinel,
  savePassphraseSentinel,
} from './idbPassphraseSentinel';

const PBKDF2_ITERATIONS = 600_000; // OWASP 2024 minimum for PBKDF2-HMAC-SHA-256
const IV_BYTE_LENGTH = 12;
const SALT_BYTE_LENGTH = 32;
const SALT_STORAGE_KEY = 'worldscript-idb-kdf-salt-v1';

// \x00enc1\x00 — 6-byte sentinel distinct from LZ prefix \x00lz1\x00
const SENTINEL = new Uint8Array([0x00, 0x65, 0x6e, 0x63, 0x31, 0x00]);

// ─── Class API (injectable for tests) ───────────────────────────────────────

export interface EncryptedBlob {
  /** sentinel(6) || iv(12) || AES-GCM ciphertext+tag */
  bytes: Uint8Array;
}

export class StorageEncryptionService {
  /**
   * Derive a non-extractable AES-256-GCM key from a passphrase + salt.
   * SEC-RULE-5: extractable is always false.
   */
  async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey'],
    );
    return crypto.subtle.deriveKey(
      // QNBS-v3: new Uint8Array(salt) ensures ArrayBuffer backing — TS strict rejects ArrayBufferLike
      {
        name: 'PBKDF2',
        salt: new Uint8Array(salt),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      // QNBS-v3: extractable: false — key cannot leave the WebCrypto context (SEC-RULE-5)
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /** Encrypt an arbitrary value. Returns a sentinel-prefixed Uint8Array. */
  async encrypt(key: CryptoKey, data: unknown): Promise<EncryptedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const cipherBytes = new Uint8Array(cipherBuf);

    // Layout: sentinel(6) || iv(12) || ciphertext+GCM-tag(16)
    const out = new Uint8Array(SENTINEL.length + IV_BYTE_LENGTH + cipherBytes.length);
    out.set(SENTINEL, 0);
    out.set(iv, SENTINEL.length);
    out.set(cipherBytes, SENTINEL.length + IV_BYTE_LENGTH);
    return { bytes: out };
  }

  /** Decrypt a blob produced by encrypt(). Throws on wrong key or corruption. */
  async decrypt(key: CryptoKey, blob: EncryptedBlob): Promise<unknown> {
    const { bytes } = blob;
    if (bytes.length < SENTINEL.length + IV_BYTE_LENGTH) {
      throw new Error('Encrypted blob is too short');
    }
    // Verify sentinel
    for (let i = 0; i < SENTINEL.length; i++) {
      if (bytes[i] !== SENTINEL[i]) throw new Error('Not an encrypted blob — sentinel mismatch');
    }
    const iv = bytes.slice(SENTINEL.length, SENTINEL.length + IV_BYTE_LENGTH);
    const ciphertext = bytes.slice(SENTINEL.length + IV_BYTE_LENGTH);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuf)) as unknown;
  }

  /**
   * Re-derive a new key from newPassphrase using the same install salt.
   * Callers must re-encrypt all IDB data with the returned key.
   */
  async rotateKey(_oldKey: CryptoKey, newPassphrase: string): Promise<CryptoKey> {
    const salt = getOrCreateSalt();
    return this.deriveKey(newPassphrase, salt);
  }
}

// ─── Module-level singleton ──────────────────────────────────────────────────

const _svc = new StorageEncryptionService();
let _activeKey: CryptoKey | null = null;

function getOrCreateSalt(): Uint8Array {
  try {
    const stored = localStorage.getItem(SALT_STORAGE_KEY);
    if (stored) {
      const arr = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
      if (arr.length === SALT_BYTE_LENGTH) return arr;
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
    const b64 = btoa(String.fromCharCode(...salt));
    localStorage.setItem(SALT_STORAGE_KEY, b64);
    return salt;
  } catch {
    // QNBS-v3: SSR / test env without localStorage — return zero-filled fallback salt.
    return new Uint8Array(SALT_BYTE_LENGTH);
  }
}

/**
 * Initialise the session encryption key from a passphrase.
 * Must be called before any idbEncrypt / idbDecrypt calls.
 */
export async function initIdbEncryption(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('Passphrase must not be empty');
  const salt = getOrCreateSalt();
  _activeKey = await _svc.deriveKey(passphrase, salt);
}

/** Encrypt plaintext data with the active session key. */
export async function idbEncrypt(plaintext: unknown): Promise<Uint8Array> {
  if (!_activeKey) throw new Error('IDB encryption not initialised — call initIdbEncryption first');
  const blob = await _svc.encrypt(_activeKey, plaintext);
  return blob.bytes;
}

/** Decrypt a Uint8Array produced by idbEncrypt. */
export async function idbDecrypt<T>(bytes: Uint8Array): Promise<T> {
  if (!_activeKey) throw new Error('IDB encryption not initialised — call initIdbEncryption first');
  return _svc.decrypt(_activeKey, { bytes }) as Promise<T>;
}

/** Returns true once initIdbEncryption() has completed successfully. */
export function isIdbEncryptionReady(): boolean {
  return _activeKey !== null;
}

/** Clear the in-memory key (call on tab-hide / session end). */
export function clearIdbEncryptionKey(): void {
  _activeKey = null;
}

/** Type-guard: returns true if a stored IDB value looks like an encrypted blob. */
export function isEncryptedBlob(value: unknown): value is Uint8Array {
  if (!(value instanceof Uint8Array)) return false;
  if (value.length < SENTINEL.length) return false;
  for (let i = 0; i < SENTINEL.length; i++) {
    if (value[i] !== SENTINEL[i]) return false;
  }
  return true;
}

/**
 * Unified read helper: decrypts encrypted blobs when the key is available,
 * decompresses plaintext legacy data, and throws a clear user-facing error
 * when encrypted data is encountered without an active key.
 * QNBS-v3: Prevents silent data corruption when encryption is disabled
 * after encrypted data already exists.
 */
export async function idbReadSecure<T>(raw: unknown): Promise<T> {
  if (isEncryptedBlob(raw)) {
    if (!isIdbEncryptionReady()) {
      throw new Error(
        'Data is encrypted but encryption key is not available. ' +
          'Please re-enable encryption in Settings → Privacy to access your data.',
      );
    }
    return idbDecrypt<T>(raw);
  }
  return decompressData<T>(raw);
}

// ─── Sentinel-backed API (correct opt-in behaviour) ─────────────────────────

/**
 * Set up encryption for the first time (or after a change):
 * derives key → encrypts sentinel → persists sentinel in IDB → activates the key.
 * Call from the "set passphrase" UI flow.
 */
export async function setupIdbEncryption(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('Passphrase must not be empty');
  const salt = getOrCreateSalt();
  const key = await _svc.deriveKey(passphrase, salt);
  const blob = await _svc.encrypt(key, { v: 1 });
  await savePassphraseSentinel(blob.bytes);
  _activeKey = key;
}

/**
 * Verify passphrase against the stored sentinel then activate the key.
 * Throws if the passphrase is wrong (AES-GCM auth-tag mismatch) or if no
 * sentinel exists (encryption was never properly set up).
 * Call from IdbUnlockModal.
 */
export async function verifyAndInitIdbEncryption(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('Passphrase must not be empty');
  const sentinelBytes = await getPassphraseSentinel();
  if (!sentinelBytes) throw new Error('No passphrase sentinel found — encryption was not set up');
  const salt = getOrCreateSalt();
  const key = await _svc.deriveKey(passphrase, salt);
  // QNBS-v3: decrypt throws on wrong key — AES-GCM auth-tag is the verifier
  await _svc.decrypt(key, { bytes: sentinelBytes });
  _activeKey = key;
}

/**
 * Returns true if a passphrase sentinel exists in IDB, meaning the user has
 * previously configured encryption. Used by App.tsx startup guard to auto-heal
 * a stale flag (flag on, no sentinel → flag never properly set up → disable flag).
 */
export async function hasPassphraseSentinel(): Promise<boolean> {
  const bytes = await getPassphraseSentinel();
  return bytes !== null;
}

/**
 * Delete the passphrase sentinel from IDB and clear the in-memory key.
 * Call when the user disables encryption (after verifying current passphrase).
 */
export async function clearIdbPassphrase(): Promise<void> {
  await deletePassphraseSentinel();
  _activeKey = null;
}

/**
 * Change the passphrase: verify the old one against the sentinel, derive the new
 * key, replace the sentinel, then optionally re-encrypt all existing IDB data.
 *
 * @param reEncrypt — optional callback that receives (oldKey, newKey) and must
 *   re-encrypt all existing data. Called while oldKey is still valid so decryption
 *   of legacy records is possible. If omitted, old data remains encrypted under
 *   the old key until the next natural overwrite.
 */
export async function rotateIdbPassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  reEncrypt?: (oldKey: CryptoKey, newKey: CryptoKey) => Promise<void>,
): Promise<void> {
  // QNBS-v3: verifyAndInitIdbEncryption throws on wrong old passphrase — caller catches and shows error
  await verifyAndInitIdbEncryption(oldPassphrase);
  const oldKey = _activeKey;
  if (!oldKey) throw new Error('Encryption not active');
  await setupIdbEncryption(newPassphrase);
  const newKey = _activeKey;
  if (!newKey) throw new Error('Encryption not active after rotation');
  if (reEncrypt) {
    await reEncrypt(oldKey, newKey);
  }
}
