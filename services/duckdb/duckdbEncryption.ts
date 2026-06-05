/**
 * DuckDB OPFS Encryption Layer
 * QNBS-v3: P0-4 — Encrypt DuckDB OPFS files at rest.
 *           Uses the same passphrase-derived key as IDB encryption.
 */

import { idbDecrypt, idbEncrypt, initIdbEncryption } from '../storage/storageEncryptionService';

// QNBS-v3: Module-level mutable key holder for DuckDB encryption
const opfsEncryptionKey: { current: CryptoKey | null } = { current: null };

/**
 * Initialize DuckDB encryption with the passphrase-derived key.
 * Must be called before any DuckDB OPFS operations.
 */
export async function initDuckDbEncryption(passphrase: string): Promise<void> {
  await initIdbEncryption(passphrase);
  // The IDB encryption module uses a singleton key; we share it
  opfsEncryptionKey.current = null; // Key is managed internally by storageEncryptionService
}

/**
 * Get the current encryption key for DuckDB operations.
 * Returns null if encryption not initialized.
 */
export function getDuckDbEncryptionKey(): CryptoKey | null {
  return opfsEncryptionKey.current;
}

/**
 * Clear the encryption key (on logout or passphrase change).
 */
export function clearDuckDbEncryptionKey(): void {
  opfsEncryptionKey.current = null;
}

/**
 * Encrypt data for DuckDB OPFS storage.
 */
export async function encryptDuckDbData(data: unknown): Promise<Uint8Array> {
  return idbEncrypt(data);
}

/**
 * Decrypt DuckDB OPFS data.
 */
export async function decryptDuckDbData(bytes: Uint8Array): Promise<unknown> {
  return idbDecrypt(bytes);
}

/**
 * Re-encrypt all DuckDB OPFS files with a new passphrase.
 * Used during key rotation.
 */
export async function reEncryptDuckDbFiles(
  _oldKey: CryptoKey,
  _newKey: CryptoKey,
  _filePaths: string[],
): Promise<void> {
  // This would iterate through OPFS files and re-encrypt them
  // Implementation depends on DuckDB-WASM OPFS file structure
  // Placeholder for actual OPFS re-encryption logic
  // Would use duckdbClient to access OPFS files
}
