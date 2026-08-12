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
import { getPassphraseSentinel, savePassphraseSentinel } from './idbPassphraseSentinel';

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

// QNBS-v3: Explicit typed errors — callers branch on `.code`, so a locked read/write and an
//          incomplete migration must never collapse into a generic Error a caller could ignore.
/** Raised when configured at-rest encryption has no session key for a protected operation. */
export class IdbStorageLockedError extends Error {
  readonly code = 'STORAGE_LOCKED' as const;

  constructor() {
    super('Encrypted storage is locked');
    this.name = 'IdbStorageLockedError';
  }
}

/** Raised instead of risking an incomplete cross-database disable or passphrase rotation. */
export class IdbEncryptionMigrationRequiredError extends Error {
  readonly code = 'ENCRYPTION_MIGRATION_REQUIRED' as const;

  constructor(operation: 'disable' | 'rotate') {
    super(`Cannot ${operation} encrypted storage without a completed migration journal`);
    this.name = 'IdbEncryptionMigrationRequiredError';
  }
}

/**
 * Raised when the persisted KDF salt is missing or invalid while a passphrase sentinel already
 * exists — deriving a fresh salt at that point would silently produce a different key and
 * permanently orphan existing encrypted data instead of surfacing the loss.
 */
export class IdbEncryptionSaltLostError extends Error {
  readonly code = 'ENCRYPTION_SALT_LOST' as const;

  constructor() {
    super(
      'Encryption salt is missing or invalid, but a passphrase was previously configured — a new salt cannot be created without losing access to existing encrypted data',
    );
    this.name = 'IdbEncryptionSaltLostError';
  }
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
    const salt = await getOrCreateSalt();
    return this.deriveKey(newPassphrase, salt);
  }
}

// ─── Module-level singleton ──────────────────────────────────────────────────

const _svc = new StorageEncryptionService();
let _activeKey: CryptoKey | null = null;
// QNBS-v3: Caches a known-true sentinel so hot read/write paths skip an IDB round trip on every
//          call; safe because disable/rotate (the only ops that could make it false again) both
//          unconditionally throw IdbEncryptionMigrationRequiredError today (see below).
let _sentinelPresenceCache: boolean | null = null;

async function getOrCreateSalt(): Promise<Uint8Array> {
  try {
    const stored = localStorage.getItem(SALT_STORAGE_KEY);
    if (stored) {
      const arr = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
      if (arr.length === SALT_BYTE_LENGTH) return arr;
    }
  } catch (error) {
    throw new Error('Unable to persist encryption salt', { cause: error });
  }
  // QNBS-v3: only first-time setup (no sentinel yet) may create a fresh salt — a missing/invalid
  // salt after that point means the original key material is unrecoverable, so fail closed instead
  // of silently deriving a different key that can never decrypt the existing sentinel/data.
  if (await hasPassphraseSentinel()) {
    throw new IdbEncryptionSaltLostError();
  }
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
    const b64 = btoa(String.fromCharCode(...salt));
    localStorage.setItem(SALT_STORAGE_KEY, b64);
    return salt;
  } catch (error) {
    // QNBS-v3: A deterministic fallback salt would weaken every new encrypted library.
    throw new Error('Unable to persist encryption salt', { cause: error });
  }
}

/**
 * Initialise the session encryption key from a passphrase.
 * Must be called before any idbEncrypt / idbDecrypt calls.
 */
export async function initIdbEncryption(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('Passphrase must not be empty');
  const salt = await getOrCreateSalt();
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

// QNBS-v3: Must run before any protected IDB access — the session key can be cleared between
//          two awaits, so every protected read/write checks it fresh rather than caching a stale "unlocked" result.
/**
 * Reject a protected durable write while encryption is configured but the key is locked.
 * Call this before opening an IDB write transaction so callers cannot downgrade to plaintext.
 */
export async function assertIdbProtectedWriteAllowed(): Promise<void> {
  if (_activeKey) return;
  if (await hasPassphraseSentinel()) throw new IdbStorageLockedError();
}

/**
 * Atomically resolve whether a protected write may proceed AND the exact key to encrypt with,
 * in one snapshot. QNBS-v3: a caller that instead awaits assertIdbProtectedWriteAllowed() and
 * later re-reads isIdbEncryptionReady()/_activeKey after another await (e.g. opening an IDB
 * transaction) can have Lock Session race in between and silently fall back to a plaintext
 * write; capturing the CryptoKey once here and encrypting with that exact reference (via
 * idbEncryptWithKey) removes the gap entirely, independent of caller ordering.
 */
export async function resolveProtectedWriteKey(): Promise<CryptoKey | null> {
  if (_activeKey) return _activeKey;
  if (await hasPassphraseSentinel()) throw new IdbStorageLockedError();
  return null;
}

/** Encrypt with an explicit key captured via resolveProtectedWriteKey — immune to a later clearIdbEncryptionKey(). */
export async function idbEncryptWithKey(key: CryptoKey, plaintext: unknown): Promise<Uint8Array> {
  const blob = await _svc.encrypt(key, plaintext);
  return blob.bytes;
}

/** Clear the in-memory key (call on tab-hide / session end). */
export function clearIdbEncryptionKey(): void {
  _activeKey = null;
  // QNBS-v3: also drop the sentinel-presence cache — tests (and any future out-of-band sentinel
  // deletion) rely on this call to force the next hasPassphraseSentinel() back to a fresh IDB read.
  _sentinelPresenceCache = null;
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
      throw new IdbStorageLockedError();
    }
    return idbDecrypt<T>(raw);
  }
  // QNBS-v3: Legacy plaintext remains readable only after unlock so a locked library cannot expose protected content.
  await assertIdbProtectedWriteAllowed();
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
  const salt = await getOrCreateSalt();
  const key = await _svc.deriveKey(passphrase, salt);
  const blob = await _svc.encrypt(key, { v: 1 });
  await savePassphraseSentinel(blob.bytes);
  _activeKey = key;
  // QNBS-v3: sentinel now durably exists — update the cache immediately instead of waiting for
  // the next hasPassphraseSentinel() call to re-derive it from an IDB read.
  _sentinelPresenceCache = true;
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
  // QNBS-v3: sentinelBytes being non-null already proves the sentinel exists — populate the cache
  // from this read instead of letting the next hasPassphraseSentinel() call repeat the IDB lookup.
  _sentinelPresenceCache = true;
  const salt = await getOrCreateSalt();
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
  // QNBS-v3: Only a positive result is cached. Setup can happen in another tab (or, once rotate/
  // disable ship, sentinel state can otherwise change) after this tab observed "no sentinel" —
  // caching that negative would let resolveProtectedWriteKey()/assertIdbProtectedWriteAllowed()
  // keep treating a now-configured library as never-configured and silently allow a plaintext
  // write. A negative lookup still costs one IDB read each time, which is the fail-closed direction.
  if (_sentinelPresenceCache === true) return true;
  const bytes = await getPassphraseSentinel();
  if (bytes !== null) _sentinelPresenceCache = true;
  return bytes !== null;
}

/**
 * Disabling encryption is blocked until a verified, resumable conversion protocol covers every
 * protected store. Deleting the verifier first would strand existing ciphertext.
 */
export async function clearIdbPassphrase(): Promise<void> {
  throw new IdbEncryptionMigrationRequiredError('disable');
}

/**
 * Rekey is intentionally unavailable until a durable, cross-store journal can prove that mixed
 * generations are recoverable after interruption. The arguments remain for source compatibility.
 */
export async function rotateIdbPassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  reEncrypt?: (oldKey: CryptoKey, newKey: CryptoKey) => Promise<void>,
): Promise<void> {
  void oldPassphrase;
  void newPassphrase;
  void reEncrypt;
  // QNBS-v3: A new verifier cannot become authoritative before every old ciphertext is checkpointed and verified.
  throw new IdbEncryptionMigrationRequiredError('rotate');
}
