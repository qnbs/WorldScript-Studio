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

// QNBS-v3: per-path write queue serializes same-path atomic writes in call order — without it, two overlapping saves race on which rename finishes last, letting an older save overwrite a newer one; entries self-delete once settled and unclaimed, so this never grows unbounded.
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const previousSettled = writeQueues.get(path) ?? Promise.resolve();
  const result = previousSettled.then(fn);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(path, settled);
  settled.then(() => {
    if (writeQueues.get(path) === settled) writeQueues.delete(path);
  });
  return result;
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
  try {
    await write();
  } catch (err) {
    await apis.remove(tmpPath).catch(() => {});
    throw err;
  }
  await atomicRename(apis, tmpPath, finalPath);
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

// --- Base64 codec helpers ---
// QNBS-v3: previously private to a now-removed derived-passphrase crypto scheme (F-05/F-06 fix, then found still-insecure — see settingsFsStore.ts header comment); API-key protection now reuses storageEncryptionService.ts's real passphrase-derived key directly, and these two helpers stay, exported, as the JSON-safe codec for its Uint8Array ciphertext.

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

// QNBS-v3: explicit Uint8Array<ArrayBuffer> return type — a bare `Uint8Array` annotation widens to `Uint8Array<ArrayBufferLike>` (includes SharedArrayBuffer), rejected by crypto.subtle as a BufferSource; same pattern as libraryBackupService.ts#copyToFixedBuffer.
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
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
      if (TEMP_FILE_PATTERN.test(entry.name)) {
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
