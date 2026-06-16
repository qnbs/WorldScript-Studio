// QNBS-v3: AES-256-GCM envelope for cloud-sync payloads — same KDF as collaborationService (PBKDF2 SHA-256, 600k iterations, OWASP 2024 minimum).

const PBKDF2_ITERATIONS = 600_000;
const IV_LENGTH = 12;

/** Derives a per-user AES-256-GCM key from a passphrase + deterministic salt (userId). */
export async function deriveCloudSyncKey(passphrase: string, userId: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(passphrase);
  const saltInput = new TextEncoder().encode(`worldscript-cloud-sync::${userId}`);
  const salt = await crypto.subtle.digest('SHA-256', saltInput);

  const keyMaterial = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts a JSON-serialisable value; returns base64(IV + ciphertext). */
export async function encryptCloudPayload<T>(key: CryptoKey, data: T): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypts a base64(IV + ciphertext) envelope; returns the original value. */
export async function decryptCloudPayload<T>(key: CryptoKey, encoded: string): Promise<T> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
