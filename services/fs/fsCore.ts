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

async function deriveFileSystemCryptoKey(secretMaterial: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = encoder.encode(secretMaterial);
  const hash = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(
  value: string,
  secretMaterial: string,
): Promise<{ iv: string; data: string }> {
  const key = await deriveFileSystemCryptoKey(secretMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(iv)))),
    data: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(encrypted)))),
  };
}

export async function decryptText(
  payload: { iv: string; data: string },
  secretMaterial: string,
): Promise<string> {
  const key = await deriveFileSystemCryptoKey(secretMaterial);
  const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
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
