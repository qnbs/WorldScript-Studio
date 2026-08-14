/**
 * FsCore — Shared Tauri FS utilities: API loader, retry, compress/decompress, crypto, path helpers.
 * QNBS-v3: Extracted from fileSystemService.ts. Base class owns appDataPath + API loading.
 */

import LZString from 'lz-string';
import { logger } from '../logger';

// Dynamic imports for Tauri v2 plugin APIs — fail gracefully in browser
export type TauriApis = {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  readDir: (path: string) => Promise<{ name?: string; isDirectory?: boolean }[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  open: (opts?: Record<string, unknown>) => Promise<string | null>;
  save: (opts?: Record<string, unknown>) => Promise<string | null>;
  appDataDir: () => Promise<string>;
  join: (...parts: string[]) => Promise<string>;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

let tauriApis: TauriApis | null = null;

export async function loadTauriApis(): Promise<TauriApis> {
  if (tauriApis) return tauriApis;
  try {
    const [coreModule, fsModule, dialogModule, pathModule] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/path'),
    ]);
    tauriApis = {
      invoke: coreModule.invoke as TauriApis['invoke'],
      readTextFile: fsModule.readTextFile,
      writeTextFile: fsModule.writeTextFile,
      readFile: fsModule.readFile,
      writeFile: fsModule.writeFile,
      mkdir: fsModule.mkdir,
      exists: fsModule.exists,
      readDir: fsModule.readDir as TauriApis['readDir'],
      remove: fsModule.remove,
      rename: fsModule.rename,
      open: dialogModule.open as TauriApis['open'],
      save: dialogModule.save as TauriApis['save'],
      appDataDir: pathModule.appDataDir,
      join: pathModule.join,
    };
    return tauriApis;
  } catch {
    throw new Error('Tauri APIs not available in this environment');
  }
}

// --- Retry helper for transient filesystem errors ---

export async function retryFs<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isTransient =
        msg.includes('busy') ||
        msg.includes('temporarily') ||
        msg.includes('locked') ||
        msg.includes('try again') ||
        msg.includes('resource unavailable');
      if (!isTransient || attempt >= retries) break;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw lastError;
}

function temporaryPath(path: string): string {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
  return `${path}.tmp-${suffix}`;
}

const atomicWriteTails = new Map<string, Promise<void>>();

async function writeAndReplace(
  apis: TauriApis,
  path: string,
  write: (temporary: string) => Promise<void>,
): Promise<void> {
  const previous = atomicWriteTails.get(path);
  const current = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
    const temporary = temporaryPath(path);
    try {
      await retryFs(() => write(temporary));
      await retryFs(() => apis.rename(temporary, path));
    } catch (error) {
      await apis.remove(temporary).catch(() => undefined);
      throw error;
    }
  });
  atomicWriteTails.set(path, current);
  try {
    await current;
  } finally {
    if (atomicWriteTails.get(path) === current) {
      atomicWriteTails.delete(path);
    }
  }
}

// QNBS-v3: replace authoritative files only after a complete sibling write, preserving the last valid file on interruption.
export function writeTextFileAtomic(apis: TauriApis, path: string, content: string): Promise<void> {
  return writeAndReplace(apis, path, (temporary) => apis.writeTextFile(temporary, content));
}

// QNBS-v3: binary assets use the same same-directory replace so readers never observe a partial file.
export function writeFileAtomic(apis: TauriApis, path: string, data: Uint8Array): Promise<void> {
  return writeAndReplace(apis, path, (temporary) => apis.writeFile(temporary, data));
}

// --- LZ-String compression (mirrors dbService threshold and prefix) ---

const COMPRESS_THRESHOLD = 10_240;
const LZ_PREFIX = '\x00lz1\x00';

export function compressData<T>(data: T): string {
  const json = JSON.stringify(data);
  if (json.length < COMPRESS_THRESHOLD) return json;
  return LZ_PREFIX + LZString.compressToUTF16(json);
}

export function decompressData<T>(raw: string): T {
  if (raw.startsWith(LZ_PREFIX)) {
    const decompressed = LZString.decompressFromUTF16(raw.slice(LZ_PREFIX.length));
    return JSON.parse(decompressed ?? '{}') as T;
  }
  return JSON.parse(raw) as T;
}

// --- Crypto helpers ---
// QNBS-v3: PBKDF2-SHA-256 (600k iter, OWASP 2024 minimum) + random 32-byte salt per encryption,
// mirroring services/storage/storageEncryptionService.ts#deriveKey. The prior scheme derived the
// key from a single unsalted SHA-256 digest of publicly-derivable material
// (`${appDataPath}|${provider}|WorldScriptStudio|v1` — anyone who can read the encrypted file
// already knows its own parent path and the provider from the filename), making it obfuscation,
// not encryption (F-05/F-06). No migration path for pre-existing `*_key.enc.json` files: a legacy
// payload (no `salt` field) is treated as unreadable — see decryptText below and
// FsSettingsStore#getApiKey, which already returns null on any decrypt failure so the caller
// naturally re-prompts for the key.

const PBKDF2_ITERATIONS = 600_000; // OWASP 2024 minimum for PBKDF2-HMAC-SHA-256
const SALT_BYTE_LENGTH = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

// QNBS-v3: explicit Uint8Array<ArrayBuffer> return type — a bare `Uint8Array` annotation widens to
// `Uint8Array<ArrayBufferLike>` (includes SharedArrayBuffer), which crypto.subtle rejects as a
// BufferSource. Same pattern as services/libraryBackupService.ts#copyToFixedBuffer.
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function deriveFileSystemCryptoKey(
  secretMaterial: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretMaterial),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    // QNBS-v3: extractable: false — key cannot leave the WebCrypto context.
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedFsPayload {
  iv: string;
  salt: string;
  data: string;
}

export async function encryptText(
  value: string,
  secretMaterial: string,
): Promise<EncryptedFsPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const key = await deriveFileSystemCryptoKey(secretMaterial, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptText(
  payload: { iv: string; salt?: string; data: string },
  secretMaterial: string,
): Promise<string> {
  if (!payload.salt) {
    // QNBS-v3: pre-2026-07-29 payloads have no salt field (unsalted single-SHA-256 scheme, F-05).
    // Not migrated by design (locked decision) — the caller treats this as "no key available".
    throw new Error('Legacy unsalted key payload is no longer supported; re-enter the API key.');
  }
  const salt = base64ToBytes(payload.salt);
  const key = await deriveFileSystemCryptoKey(secretMaterial, salt);
  const iv = base64ToBytes(payload.iv);
  const encrypted = base64ToBytes(payload.data);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

// --- Path sanitization helpers ---

const stripControlChars = (value: string): string => {
  let output = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (!char) continue;
    const code = char.charCodeAt(0);
    output += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
  }
  return output;
};

export const sanitizePathSegment = (segment: string, fallback = 'item'): string => {
  const raw = stripControlChars(String(segment).trim());
  const cleaned = raw
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
};

export function countProjectWords(projectData: unknown): number {
  try {
    const proj = projectData as { manuscript?: { content?: string }[] };
    if (!Array.isArray(proj?.manuscript)) return 0;
    const fullText = proj.manuscript.map((s) => s.content ?? '').join(' ');
    return fullText.split(/\s+/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

// --- Base class: Tauri path resolution ---

export class FsCore {
  protected appDataPath: string | null = null;
  protected lastAutoSnapshotTime = Date.now();
  protected readonly AUTO_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  protected readonly MAX_AUTO_SNAPSHOTS = 20;

  async initialize(): Promise<void> {
    try {
      const apis = await loadTauriApis();
      this.appDataPath = await apis.appDataDir();
    } catch (error) {
      logger.error('Failed to get app data directory:', error);
      throw error;
    }
  }

  protected async ensureAppDataPath(): Promise<string> {
    if (!this.appDataPath) {
      await this.initialize();
    }
    return this.appDataPath!;
  }

  protected async getApis(): Promise<TauriApis> {
    return loadTauriApis();
  }
}
