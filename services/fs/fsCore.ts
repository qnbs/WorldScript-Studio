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

// --- Atomic writes (write-temp-then-rename) ---
// QNBS-v3: write-temp-then-rename replaces prior direct writeTextFile/writeFile calls to the final path (crash/power-loss mid-write could truncate it); rename() replaces an existing destination per @tauri-apps/plugin-fs 2.5.1's own dist-js/index.d.ts docs, so readers only ever see the old or new complete file, never a partial one.

// QNBS-v3: crypto.randomUUID() is unsupported on some older WebKit still within this app's declared minimumSystemVersion — same feature-detected fallback as createMigrationOperationId() in encryptionMigrationOrchestrator.ts.
function createTempSuffix(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// QNBS-v3: tracks temp files mid-write so the startup sweep never deletes one racing an active save right after initialize().
const activeTempPaths = new Set<string>();

interface QueuedWrite {
  fn: () => Promise<void>;
  waiters: Array<{ resolve: () => void; reject: (reason: unknown) => void }>;
}

// QNBS-v3: one write in flight per path plus at most one queued "next" write — a write arriving while one is already queued supersedes it, bounding memory/I/O for a same-path write burst.
const inFlightPaths = new Set<string>();
const nextWrite = new Map<string, QueuedWrite>();

function enqueueWrite(path: string, fn: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiter = { resolve, reject };
    const queued = nextWrite.get(path);
    if (queued) {
      queued.fn = fn;
      queued.waiters.push(waiter);
      return;
    }
    if (inFlightPaths.has(path)) {
      nextWrite.set(path, { fn, waiters: [waiter] });
      return;
    }
    void runQueuedWrite(path, fn, [waiter]);
  });
}

async function runQueuedWrite(
  path: string,
  fn: () => Promise<void>,
  waiters: Array<{ resolve: () => void; reject: (reason: unknown) => void }>,
): Promise<void> {
  inFlightPaths.add(path);
  try {
    await fn();
    for (const waiter of waiters) waiter.resolve();
  } catch (err) {
    for (const waiter of waiters) waiter.reject(err);
  } finally {
    inFlightPaths.delete(path);
  }
  const queued = nextWrite.get(path);
  if (queued) {
    nextWrite.delete(path);
    void runQueuedWrite(path, queued.fn, queued.waiters);
  }
}

async function atomicRename(apis: TauriApis, tmpPath: string, finalPath: string): Promise<void> {
  try {
    await retryFs(() => apis.rename(tmpPath, finalPath));
  } catch (err) {
    // Best-effort cleanup of the orphaned temp file; the original write error is what matters.
    await apis.remove(tmpPath).catch(() => {});
    throw err;
  }
}

// QNBS-v3: cleans up the orphaned temp file on a WRITE failure too, not just on rename failure — otherwise a failed temp write (e.g. disk full mid-write) leaves a uniquely-named orphan behind.
async function writeThenRename(
  apis: TauriApis,
  tmpPath: string,
  finalPath: string,
  write: () => Promise<void>,
): Promise<void> {
  activeTempPaths.add(tmpPath);
  try {
    try {
      await write();
    } catch (err) {
      await apis.remove(tmpPath).catch(() => {});
      throw err;
    }
    await atomicRename(apis, tmpPath, finalPath);
  } finally {
    activeTempPaths.delete(tmpPath);
  }
}

export function writeTextFileAtomic(apis: TauriApis, path: string, content: string): Promise<void> {
  return enqueueWrite(path, () => {
    const tmpPath = `${path}.tmp-${createTempSuffix()}`;
    return writeThenRename(apis, tmpPath, path, () =>
      retryFs(() => apis.writeTextFile(tmpPath, content)),
    );
  });
}

export function writeFileAtomic(apis: TauriApis, path: string, data: Uint8Array): Promise<void> {
  return enqueueWrite(path, () => {
    const tmpPath = `${path}.tmp-${createTempSuffix()}`;
    return writeThenRename(apis, tmpPath, path, () => retryFs(() => apis.writeFile(tmpPath, data)));
  });
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
// QNBS-v3: PBKDF2-SHA-256 (600k iter, OWASP 2024 minimum) + random 32-byte salt, mirroring storageEncryptionService.ts#deriveKey, replacing a prior unsalted-SHA-256-of-public-material scheme (F-05/F-06); legacy (no `salt` field) payloads are treated as unreadable, not migrated — see decryptText below.

const PBKDF2_ITERATIONS = 600_000; // OWASP 2024 minimum for PBKDF2-HMAC-SHA-256
const SALT_BYTE_LENGTH = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

// QNBS-v3: explicit Uint8Array<ArrayBuffer> return type — a bare `Uint8Array` annotation widens to `Uint8Array<ArrayBufferLike>` (includes SharedArrayBuffer), rejected by crypto.subtle as a BufferSource; same pattern as libraryBackupService.ts#copyToFixedBuffer.
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
    // QNBS-v3: pre-2026-07-29 payloads have no salt field (unsalted single-SHA-256 scheme, F-05) — not migrated by design (locked decision); the caller treats this as "no key available".
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

// QNBS-v3: both atomicRename's and writeThenRename's cleanup only run when a JS promise actually rejects — a process kill (crash/power-loss) mid-write stops execution before either handler runs, leaving a uniquely-named `.tmp-*` orphan with no in-session path to reclaim it. Swept once at startup below.
const TEMP_FILE_PATTERN = /\.tmp-[0-9a-f-]+$/i;

export async function cleanupOrphanedTempFiles(
  apis: TauriApis,
  dir: string,
  depth = 0,
): Promise<void> {
  if (depth > 6) return; // guard against an unexpectedly deep tree
  let entries: { name?: string; isDirectory?: boolean }[];
  try {
    entries = await apis.readDir(dir);
  } catch {
    return; // directory may not exist yet on a fresh install — nothing to clean up
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.name) return;
      const entryPath = await apis.join(dir, entry.name);
      if (entry.isDirectory) {
        await cleanupOrphanedTempFiles(apis, entryPath, depth + 1);
        return;
      }
      if (TEMP_FILE_PATTERN.test(entry.name) && !activeTempPaths.has(entryPath)) {
        await apis.remove(entryPath).catch(() => {});
      }
    }),
  );
}

export class FsCore {
  protected appDataPath: string | null = null;
  protected lastAutoSnapshotTime = Date.now();
  protected readonly AUTO_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  protected readonly MAX_AUTO_SNAPSHOTS = 20;

  async initialize(): Promise<void> {
    let apis: TauriApis;
    try {
      apis = await loadTauriApis();
      this.appDataPath = await apis.appDataDir();
    } catch (error) {
      logger.error('Failed to get app data directory:', error);
      throw error;
    }
    // Fire-and-forget: never delays the caller waiting on this initialize() call.
    cleanupOrphanedTempFiles(apis, this.appDataPath).catch((error) => {
      logger.warn('Failed to clean up orphaned temp files:', error);
    });
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
