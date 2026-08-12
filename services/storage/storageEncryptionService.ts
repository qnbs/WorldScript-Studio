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

import {
  assertNoActiveEncryptionMigration,
  clearCompletedEncryptionMigration,
  completeEncryptionMigration,
  type EncryptionMigrationJournal,
  readEncryptionMigrationJournal,
} from './encryptionMigrationJournal';
import { decompressData } from './idbCore';
import {
  deletePassphraseSentinel,
  getPassphraseSentinel,
  savePassphraseSentinel,
} from './idbPassphraseSentinel';
// QNBS-v3: type-only — erased at compile time, so it cannot participate in the runtime circular
// dependency the dynamic imports below avoid (see clearIdbPassphrase()).
import type { ProtectedStoreMigrationProgressCallback } from './protectedStoreMigration';
import { decodeSecureRecordValue, encodeSecureRecordValue } from './secureRecordCodec';

// QNBS-v3: re-exported so a write that already captured its key via resolveProtectedWriteKey() can re-check only the migration guard pre-write, without re-running its redundant lock check.
export { assertNoActiveEncryptionMigration } from './encryptionMigrationJournal';

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

const LEGACY_BOUND_SECURE_RECORD_VERSION = 1 as const;
export const SECURE_RECORD_VERSION = 2 as const;
type SecureRecordVersion = typeof LEGACY_BOUND_SECURE_RECORD_VERSION | typeof SECURE_RECORD_VERSION;

/** Structured-clone-safe AES-GCM envelope for a secondary-store payload. */
export interface SecureRecordEnvelope {
  version: SecureRecordVersion;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export interface SecureRecordContext {
  /** Stable protected-store namespace, including the database where names can collide. */
  store: string;
  /** Immutable logical record identity used as AES-GCM additional authenticated data. */
  recordId: string;
  /** Prior documented namespaces accepted only for a verified one-way migration. */
  legacyStores?: readonly string[];
}

export interface SecureRecordReadResult<T> {
  value: T;
  /** True only when an unlocked legacy plaintext or legacy envelope needs a safe rewrite. */
  needsMigration: boolean;
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

/** Retained for secondary-store callers while sharing the authoritative locked-state policy. */
export class SecureRecordLockedError extends IdbStorageLockedError {
  constructor() {
    super();
    this.name = 'SecureRecordLockedError';
  }
}

export class SecureRecordCorruptError extends Error {
  readonly code = 'STORAGE_CORRUPT' as const;

  constructor() {
    super('Encrypted storage record is corrupt or uses an unsupported version');
    this.name = 'SecureRecordCorruptError';
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

  /** Encrypt already-serialized bytes, optionally binding them to stable record metadata. */
  async encryptBytes(
    key: CryptoKey,
    plaintext: Uint8Array,
    aad?: Uint8Array,
  ): Promise<EncryptedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const cipherBuf = await crypto.subtle.encrypt(
      aad ? { name: 'AES-GCM', iv, additionalData: new Uint8Array(aad) } : { name: 'AES-GCM', iv },
      key,
      new Uint8Array(plaintext),
    );
    const ciphertext = new Uint8Array(cipherBuf);
    const bytes = new Uint8Array(SENTINEL.length + IV_BYTE_LENGTH + ciphertext.length);
    bytes.set(SENTINEL, 0);
    bytes.set(iv, SENTINEL.length);
    bytes.set(ciphertext, SENTINEL.length + IV_BYTE_LENGTH);
    return { bytes };
  }

  /** Decrypt bytes produced by encryptBytes, including the same AAD when one was supplied. */
  async decryptBytes(key: CryptoKey, blob: EncryptedBlob, aad?: Uint8Array): Promise<Uint8Array> {
    const { bytes } = blob;
    if (bytes.length < SENTINEL.length + IV_BYTE_LENGTH + 16) {
      throw new Error('Encrypted blob is too short');
    }
    for (let index = 0; index < SENTINEL.length; index++) {
      if (bytes[index] !== SENTINEL[index]) throw new Error('Encrypted blob sentinel mismatch');
    }
    const iv = bytes.slice(SENTINEL.length, SENTINEL.length + IV_BYTE_LENGTH);
    const ciphertext = bytes.slice(SENTINEL.length + IV_BYTE_LENGTH);
    const plaintext = await crypto.subtle.decrypt(
      aad ? { name: 'AES-GCM', iv, additionalData: new Uint8Array(aad) } : { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  }

  /**
   * Re-derive a new key from newPassphrase using the same install salt.
   * Callers must re-encrypt all IDB data with the returned key.
   */
  async rotateKey(_oldKey: CryptoKey, newPassphrase: string): Promise<CryptoKey> {
    const salt = getExistingSalt();
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

function readStoredSalt(): Uint8Array | null {
  try {
    const stored = localStorage.getItem(SALT_STORAGE_KEY);
    if (!stored) return null;
    const salt = Uint8Array.from(atob(stored), (character) => character.charCodeAt(0));
    if (salt.length !== SALT_BYTE_LENGTH) throw new Error('Encryption salt has an invalid length');
    return salt;
  } catch (error) {
    throw new Error('Unable to read encryption salt', { cause: error });
  }
}

function createAndPersistSalt(): Uint8Array {
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

function getOrCreateSalt(): Uint8Array {
  return readStoredSalt() ?? createAndPersistSalt();
}

// QNBS-v3: best-effort — a stale salt with no sentinel is harmless (getOrCreateSalt regenerates on next setup).
function clearStoredSalt(): void {
  try {
    localStorage.removeItem(SALT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// QNBS-v3: sentinel already exists here, so a missing or corrupted salt means unrecoverable key material — fail closed with a typed error.
function getExistingSalt(): Uint8Array {
  let salt: Uint8Array | null;
  try {
    salt = readStoredSalt();
  } catch {
    throw new IdbEncryptionSaltLostError();
  }
  if (!salt) throw new IdbEncryptionSaltLostError();
  return salt;
}

/**
 * Initialise the session encryption key from a passphrase.
 * Must be called before any idbEncrypt / idbDecrypt calls.
 */
export async function initIdbEncryption(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('Passphrase must not be empty');
  await assertNoActiveEncryptionMigration();
  const salt = (await hasPassphraseSentinel()) ? getExistingSalt() : getOrCreateSalt();
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
  await assertNoActiveEncryptionMigration();
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

/**
 * Decrypt with an explicit key — used by primary-store migration adapters, which operate on a
 * source/target generation key rather than the current session's active key.
 */
export async function idbDecryptWithKey<T>(key: CryptoKey, bytes: Uint8Array): Promise<T> {
  return _svc.decrypt(key, { bytes }) as Promise<T>;
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

/** Bind a secure record to its stable storage namespace and logical identity. */
export function buildSecureRecordAad(context: SecureRecordContext): Uint8Array {
  return new TextEncoder().encode(`${context.store}:${context.recordId}`);
}

function isSecureRecordCandidate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if ('iv' in record || 'ciphertext' in record) return true;
  if (!('version' in record)) return false;
  return Object.keys(record).every(
    (key) => key === 'version' || key === 'iv' || key === 'ciphertext',
  );
}

/** Detect a complete or truncated secure-record shape so malformed ciphertext is never treated as plaintext. */
export function isSecureRecordEnvelopeCandidate(value: unknown): boolean {
  return isSecureRecordCandidate(value);
}

/** Strictly validate envelopes so truncated ciphertext cannot be misclassified as legacy plaintext. */
export function isSecureRecordEnvelope(value: unknown): value is SecureRecordEnvelope {
  if (!isSecureRecordCandidate(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record['version'] === LEGACY_BOUND_SECURE_RECORD_VERSION ||
      record['version'] === SECURE_RECORD_VERSION) &&
    record['iv'] instanceof Uint8Array &&
    record['iv'].length === IV_BYTE_LENGTH &&
    record['ciphertext'] instanceof Uint8Array &&
    record['ciphertext'].length >= 16
  );
}

function envelopeToEncryptedBlob(envelope: SecureRecordEnvelope): EncryptedBlob {
  const bytes = new Uint8Array(SENTINEL.length + IV_BYTE_LENGTH + envelope.ciphertext.length);
  bytes.set(SENTINEL, 0);
  bytes.set(envelope.iv, SENTINEL.length);
  bytes.set(envelope.ciphertext, SENTINEL.length + IV_BYTE_LENGTH);
  return { bytes };
}

function encryptedBlobToEnvelope(bytes: Uint8Array): SecureRecordEnvelope {
  return {
    version: SECURE_RECORD_VERSION,
    iv: bytes.slice(SENTINEL.length, SENTINEL.length + IV_BYTE_LENGTH),
    ciphertext: bytes.slice(SENTINEL.length + IV_BYTE_LENGTH),
  };
}

async function decryptSecureRecordValue<T>(
  key: CryptoKey,
  envelope: SecureRecordEnvelope,
  context: SecureRecordContext,
): Promise<SecureRecordReadResult<T>> {
  const blob = envelopeToEncryptedBlob(envelope);
  try {
    const plaintext = await _svc.decryptBytes(key, blob, buildSecureRecordAad(context));
    return {
      value: decodeSecureRecordValue(plaintext) as T,
      needsMigration: envelope.version !== SECURE_RECORD_VERSION,
    };
  } catch {
    if (envelope.version === SECURE_RECORD_VERSION) throw new SecureRecordCorruptError();
    for (const legacyStore of context.legacyStores ?? []) {
      try {
        const plaintext = await _svc.decryptBytes(
          key,
          blob,
          buildSecureRecordAad({ store: legacyStore, recordId: context.recordId }),
        );
        return { value: decodeSecureRecordValue(plaintext) as T, needsMigration: true };
      } catch {
        // QNBS-v3: Only an authenticated legacy namespace may fall through to the next documented format.
      }
    }
    // QNBS-v3: AAD-less ciphertext cannot prove its record/store binding, so it is recovery-required rather than rewritten.
    throw new SecureRecordCorruptError();
  }
}

async function encryptSecureRecordValue<T>(
  key: CryptoKey,
  value: T,
  context: SecureRecordContext,
): Promise<SecureRecordEnvelope> {
  const plaintext = await encodeSecureRecordValue(value);
  const blob = await _svc.encryptBytes(key, plaintext, buildSecureRecordAad(context));
  return encryptedBlobToEnvelope(blob.bytes);
}

/** Protect any secondary-store mutation with the same lock and active-migration policy as primary stores. */
export async function assertSecureStorageWritableForMutation(): Promise<void> {
  await assertIdbProtectedWriteAllowed();
}

/** Block protected reads while encryption is locked or a journal owns the storage lifecycle. */
export async function assertSecureStorageReadable(): Promise<boolean> {
  await assertNoActiveEncryptionMigration();
  const encryptionConfigured = await hasPassphraseSentinel();
  if (encryptionConfigured && !_activeKey) throw new SecureRecordLockedError();
  return encryptionConfigured;
}

/** Prepare a secondary payload without silently storing protected plaintext while the library is locked. */
export async function prepareSecureRecordPayload<T>(
  value: T,
  context: SecureRecordContext,
): Promise<T | SecureRecordEnvelope> {
  await assertIdbProtectedWriteAllowed();
  return _activeKey ? encryptSecureRecordValue(_activeKey, value, context) : value;
}

/** Key-scoped encrypt used by a journal-owned rekey adapter; it never changes the active session key. */
export async function prepareSecureRecordPayloadWithKey<T>(
  value: T,
  context: SecureRecordContext,
  key: CryptoKey,
): Promise<SecureRecordEnvelope> {
  return encryptSecureRecordValue(key, value, context);
}

/** Re-encrypt one fully validated envelope during a journal-owned rekey checkpoint. */
export async function reEncryptSecureRecordEnvelope(
  envelope: SecureRecordEnvelope,
  context: SecureRecordContext,
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<SecureRecordEnvelope> {
  const decoded = await decryptSecureRecordValue<unknown>(oldKey, envelope, context);
  return encryptSecureRecordValue(newKey, decoded.value, context);
}

/**
 * Decode records collected by one caller immediately after `assertSecureStorageReadable()` returned
 * this access value. It is intentionally narrow so batch readers do not re-query lifecycle metadata per row.
 */
export async function readSecureRecordPayloadAfterLifecycleCheck<T>(
  stored: unknown,
  context: SecureRecordContext,
  encryptionConfigured: boolean,
): Promise<SecureRecordReadResult<T>> {
  if (isSecureRecordCandidate(stored)) {
    if (!isSecureRecordEnvelope(stored)) throw new SecureRecordCorruptError();
    if (!_activeKey) throw new SecureRecordLockedError();
    return decryptSecureRecordValue<T>(_activeKey, stored, context);
  }
  if (_activeKey) return { value: stored as T, needsMigration: true };
  if (encryptionConfigured) throw new SecureRecordLockedError();
  return { value: stored as T, needsMigration: false };
}

/** Read a secondary payload with locked, malformed-envelope, and legacy states distinguished. */
export async function readSecureRecordPayload<T>(
  stored: unknown,
  context: SecureRecordContext,
): Promise<SecureRecordReadResult<T>> {
  const encryptionConfigured = await assertSecureStorageReadable();
  return readSecureRecordPayloadAfterLifecycleCheck(stored, context, encryptionConfigured);
}

/** Read with an explicitly supplied generation key while a journal owns the migration. */
export async function readSecureRecordPayloadWithKey<T>(
  stored: unknown,
  context: SecureRecordContext,
  key: CryptoKey,
): Promise<SecureRecordReadResult<T>> {
  if (isSecureRecordCandidate(stored)) {
    if (!isSecureRecordEnvelope(stored)) throw new SecureRecordCorruptError();
    return decryptSecureRecordValue<T>(key, stored, context);
  }
  return { value: stored as T, needsMigration: true };
}

/**
 * Unified read helper: decrypts encrypted blobs when the key is available,
 * decompresses plaintext legacy data, and throws a clear user-facing error
 * when encrypted data is encountered without an active key.
 * QNBS-v3: Prevents silent data corruption when encryption is disabled
 * after encrypted data already exists.
 */
export async function idbReadSecure<T>(raw: unknown): Promise<T> {
  // QNBS-v3: Keep the exported primitive fail-closed too; callers may not bypass lifecycle state by reading raw IDB values.
  await assertSecureStorageReadable();
  if (isEncryptedBlob(raw)) {
    if (!isIdbEncryptionReady()) {
      throw new IdbStorageLockedError();
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
  await assertNoActiveEncryptionMigration();
  if (await hasPassphraseSentinel()) {
    throw new Error('Encryption is already configured; use the resumable passphrase-rotation flow');
  }
  const salt = getOrCreateSalt();
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
  await assertNoActiveEncryptionMigration();
  const sentinelBytes = await getPassphraseSentinel();
  if (!sentinelBytes) throw new Error('No passphrase sentinel found — encryption was not set up');
  // QNBS-v3: sentinelBytes being non-null already proves the sentinel exists — populate the cache
  // from this read instead of letting the next hasPassphraseSentinel() call repeat the IDB lookup.
  _sentinelPresenceCache = true;
  const salt = getExistingSalt();
  const key = await _svc.deriveKey(passphrase, salt);
  // QNBS-v3: decrypt throws on wrong key — AES-GCM auth-tag is the verifier
  await _svc.decrypt(key, { bytes: sentinelBytes });
  _activeKey = key;
}

/** Create a non-secret verifier that a future enable/rekey runner must authenticate before mutation. */
export async function createIdbMigrationTargetVerifier(targetKey: CryptoKey): Promise<number[]> {
  const blob = await _svc.encrypt(targetKey, { v: 1 });
  return Array.from(blob.bytes);
}

/** Reject a supplied target key unless it decrypts the durable migration verifier exactly. */
export async function assertIdbMigrationTargetKeyMatchesVerifier(
  targetKey: CryptoKey,
  targetVerifier: readonly number[],
): Promise<void> {
  const verified = await _svc.decrypt(targetKey, { bytes: new Uint8Array(targetVerifier) });
  if (
    typeof verified !== 'object' ||
    verified === null ||
    Object.getPrototypeOf(verified) !== Object.prototype ||
    (verified as { v?: unknown }).v !== 1
  ) {
    throw new Error('Migration target verifier is invalid');
  }
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

// QNBS-v3: shared by the fresh-start disable/rotate flows below and by resumeEncryptionMigration()
// (App.tsx recovery UX) — both paths reach 'committing' via different journals but finish identically.
async function commitDisableMigration(journal: EncryptionMigrationJournal): Promise<void> {
  await deletePassphraseSentinel();
  clearStoredSalt();
  await completeEncryptionMigration(journal);
  await clearCompletedEncryptionMigration();
  _activeKey = null;
  _sentinelPresenceCache = null;
}

async function commitRekeyMigration(
  journal: EncryptionMigrationJournal,
  targetKey: CryptoKey,
): Promise<void> {
  const newSentinel = await _svc.encrypt(targetKey, { v: 1 });
  await savePassphraseSentinel(newSentinel.bytes);
  await completeEncryptionMigration(journal);
  await clearCompletedEncryptionMigration();
  _activeKey = targetKey;
  _sentinelPresenceCache = true;
}

/**
 * Disable at-rest encryption: runs a full journal-backed migration (decrypting every primary and
 * secondary protected store with the active key) via encryptionMigrationOrchestrator.ts, then
 * removes the passphrase sentinel and KDF salt only once every store is verified plaintext.
 * If the migration itself fails, the durable journal is left in place for the recovery UX
 * (App.tsx startup guard) to resume — this function never partially deletes the verifier.
 */
export async function clearIdbPassphrase(
  onProgress?: ProtectedStoreMigrationProgressCallback,
): Promise<void> {
  if (!_activeKey) throw new IdbStorageLockedError();
  const existingJournal = await readEncryptionMigrationJournal();
  if (existingJournal?.phase === 'recovery-required') {
    throw new IdbEncryptionMigrationRequiredError('disable');
  }
  await assertNoActiveEncryptionMigration();
  const sourceKey = _activeKey;
  // QNBS-v3: dynamic import breaks a static circular dependency — the orchestrator's adapter graph
  // imports back into this module's crypto primitives (idbEncryptWithKey/idbDecryptWithKey), and a
  // static top-level import here made class-declaration evaluation order (e.g.
  // ProtectedStoreMigrationAdapterError) dependent on which module entered the cycle first.
  const { runProductionEncryptionMigration } = await import('./encryptionMigrationOrchestrator');
  const journal = await runProductionEncryptionMigration({
    operation: 'disable',
    keys: { sourceKey },
    ...(onProgress ? { onProgress } : {}),
  });
  // QNBS-v3: journal is durably 'committing' here — every store has been migrated and verified
  // plaintext. Only bookkeeping remains; a failure below just needs a retry via the recovery UX.
  await commitDisableMigration(journal);
}

/**
 * Rotate (rekey) the at-rest encryption passphrase: verifies the old passphrase against the
 * durable sentinel (AES-GCM auth-tag mismatch fails closed, same as verifyAndInitIdbEncryption),
 * derives the new key, authenticates it via a durable target verifier, then runs a full
 * journal-backed re-encryption of every primary and secondary protected store. The new sentinel
 * is only saved — and the session key only swapped — once every store is verified under the new key.
 */
export async function rotateIdbPassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  onProgress?: ProtectedStoreMigrationProgressCallback,
): Promise<void> {
  if (!oldPassphrase || !newPassphrase) throw new Error('Passphrase must not be empty');
  const existingJournal = await readEncryptionMigrationJournal();
  if (existingJournal?.phase === 'recovery-required') {
    throw new IdbEncryptionMigrationRequiredError('rotate');
  }
  await assertNoActiveEncryptionMigration();
  const sourceKey = await deriveAndVerifySourceKeyFromSentinel(oldPassphrase);
  const targetKey = await _svc.deriveKey(newPassphrase, getExistingSalt());
  const targetVerifier = await createIdbMigrationTargetVerifier(targetKey);
  // QNBS-v3: dynamic import breaks a static circular dependency — see clearIdbPassphrase() above.
  const { runProductionEncryptionMigration } = await import('./encryptionMigrationOrchestrator');
  const journal = await runProductionEncryptionMigration({
    operation: 'rekey',
    keys: { sourceKey, targetKey },
    targetVerifier,
    ...(onProgress ? { onProgress } : {}),
  });
  // QNBS-v3: journal is durably 'committing' here — every store is verified re-encrypted under the
  // target key. Only bookkeeping remains; a failure below just needs a retry via the recovery UX.
  await commitRekeyMigration(journal, targetKey);
}

/**
 * Verify a candidate passphrase against the durable sentinel and return its derived key, without
 * activating a session (`_activeKey` is left untouched). Used by rotateIdbPassphrase() and by the
 * recovery UX (resumeEncryptionMigration()) to re-derive a migration's source key — CryptoKey
 * material is never persisted in the journal, only re-derivable from the passphrase + salt.
 */
export async function deriveAndVerifySourceKeyFromSentinel(passphrase: string): Promise<CryptoKey> {
  const sentinelBytes = await getPassphraseSentinel();
  if (!sentinelBytes) throw new Error('No passphrase sentinel found — encryption was not set up');
  const key = await _svc.deriveKey(passphrase, getExistingSalt());
  // QNBS-v3: decrypt throws on wrong key — AES-GCM auth-tag is the verifier, same pattern as verifyAndInitIdbEncryption.
  await _svc.decrypt(key, { bytes: sentinelBytes });
  return key;
}

/**
 * Verify a candidate passphrase against a durable migration target verifier and return its
 * derived key, without activating a session. Used by the recovery UX to re-derive the target key
 * of an interrupted rekey migration.
 */
export async function deriveAndVerifyTargetKeyFromVerifier(
  passphrase: string,
  targetVerifier: readonly number[],
): Promise<CryptoKey> {
  const key = await _svc.deriveKey(passphrase, getExistingSalt());
  await assertIdbMigrationTargetKeyMatchesVerifier(key, targetVerifier);
  return key;
}

/**
 * Resume an interrupted disable/rekey migration from a durable journal — the recovery UX
 * (App.tsx startup guard) calls this when readEncryptionMigrationJournal() returns a journal whose
 * phase is neither 'completed' nor 'recovery-required'. The passphrase(s) must be re-entered
 * because CryptoKey material is never persisted; commits identically to a fresh-start migration.
 */
export async function resumeEncryptionMigration(
  journal: EncryptionMigrationJournal,
  input: { sourcePassphrase: string; targetPassphrase?: string },
  onProgress?: ProtectedStoreMigrationProgressCallback,
): Promise<void> {
  if (journal.operation !== 'disable' && journal.operation !== 'rekey') {
    throw new Error(`Cannot resume a migration with operation "${journal.operation}"`);
  }

  // QNBS-v3: a journal already in 'committing' phase means every store's data migration is done and
  // verified — runProtectedStoreMigration() is a pure passthrough for this phase (nothing left to
  // migrate/verify), so only the commitDisableMigration/commitRekeyMigration bookkeeping below
  // remains. If a PRIOR commit attempt crashed partway through that bookkeeping, the sentinel it
  // mutates may already reflect the post-commit state — deleted for disable, replaced for rekey —
  // which makes the general source-key derivation further down fail even with the correct
  // passphrase(s). Handle both committing sub-states (not-yet-committed vs. partially-committed)
  // before falling through to the general resume path used by earlier phases.
  if (journal.phase === 'committing') {
    if (journal.operation === 'disable') {
      const sentinelStillPresent = (await getPassphraseSentinel()) !== null;
      if (!sentinelStillPresent) {
        // A prior commitDisableMigration already deleted the sentinel/salt before crashing — there is
        // no credential left to verify against; the disable itself is already effectively done.
        await completeEncryptionMigration(journal);
        await clearCompletedEncryptionMigration();
        _activeKey = null;
        _sentinelPresenceCache = null;
        return;
      }
      // Sentinel untouched — commitDisableMigration never ran. Verify identity, then commit normally.
      await deriveAndVerifySourceKeyFromSentinel(input.sourcePassphrase);
      await commitDisableMigration(journal);
      return;
    }
    // operation === 'rekey'
    if (!input.targetPassphrase) {
      throw new Error('The new passphrase is required to resume this passphrase rotation');
    }
    if (!journal.targetVerifier || journal.targetVerifier.length === 0) {
      throw new Error('Migration journal is missing its target verifier');
    }
    try {
      await deriveAndVerifySourceKeyFromSentinel(input.sourcePassphrase);
      // Old passphrase still decrypts the sentinel — commitRekeyMigration never ran. Commit normally.
      const targetKey = await deriveAndVerifyTargetKeyFromVerifier(
        input.targetPassphrase,
        journal.targetVerifier,
      );
      await commitRekeyMigration(journal, targetKey);
      return;
    } catch (sourceVerifyError) {
      // The old passphrase no longer decrypts the sentinel — a prior commitRekeyMigration may have
      // already replaced it with the new one before crashing. Confirm via the durable target
      // verifier (independent of the sentinel) before concluding the commit already happened,
      // rather than surfacing this as a wrong-passphrase error.
      const targetKey = await deriveAndVerifyTargetKeyFromVerifier(
        input.targetPassphrase,
        journal.targetVerifier,
      ).catch(() => {
        throw sourceVerifyError;
      });
      await completeEncryptionMigration(journal);
      await clearCompletedEncryptionMigration();
      _activeKey = targetKey;
      _sentinelPresenceCache = true;
      return;
    }
  }

  const sourceKey = await deriveAndVerifySourceKeyFromSentinel(input.sourcePassphrase);
  const { resumeProductionEncryptionMigration } = await import('./encryptionMigrationOrchestrator');
  if (journal.operation === 'disable') {
    const resumed = await resumeProductionEncryptionMigration(journal, { sourceKey }, onProgress);
    await commitDisableMigration(resumed);
    return;
  }
  if (!input.targetPassphrase) {
    throw new Error('The new passphrase is required to resume this passphrase rotation');
  }
  if (!journal.targetVerifier || journal.targetVerifier.length === 0) {
    throw new Error('Migration journal is missing its target verifier');
  }
  const targetKey = await deriveAndVerifyTargetKeyFromVerifier(
    input.targetPassphrase,
    journal.targetVerifier,
  );
  const resumed = await resumeProductionEncryptionMigration(
    journal,
    { sourceKey, targetKey },
    onProgress,
  );
  await commitRekeyMigration(resumed, targetKey);
}
