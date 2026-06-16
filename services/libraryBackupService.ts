/**
 * Full-library backup: aggregates StorageBackend data into one AES-GCM encrypted archive (ZIP wrapper).
 * API keys are never included — only non-secret Settings from loadSettings().
 */
import JSZip from 'jszip';
import type { Settings, StoryProject } from '../types';
import type { BinderAssetPayload } from './storageBackend';
import { storageService } from './storageService';

export const LIBRARY_BACKUP_FORMAT = 'worldscript-library-v1' as const;
// QNBS-v3: 600k matches OWASP 2024 minimum for PBKDF2-HMAC-SHA-256.
const PBKDF2_ITERATIONS = 600_000;

export interface LibraryProjectBundle {
  projectId: string;
  project: StoryProject | null;
  storyCodex: unknown;
  ragVectors: unknown[];
  binderAssets: Array<{
    assetId: string;
    meta: BinderAssetPayload['meta'];
    /** base64 of raw bytes */
    dataBase64: string;
  }>;
}

export interface LibraryBackupPayload {
  format: typeof LIBRARY_BACKUP_FORMAT;
  exportedAt: string;
  storageBackend: 'indexeddb' | 'filesystem';
  settings: Settings | null;
  projects: LibraryProjectBundle[];
  snapshots: Array<{ id: number; date: string; name: string; wordCount: number; data: unknown }>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** QNBS-v3: TS 6 / SubtleCrypto erwartet ArrayBuffer-backed Views — Kopie statt SharedArrayBuffer-Randfälle. */
function copyToFixedBuffer(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const dst = new Uint8Array(src.byteLength);
  dst.set(src);
  return dst;
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: copyToFixedBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** QNBS-v3: Testbarer Kern — gleiche Parameter wie ZIP-Export (Passphrase bleibt nur beim Nutzer). */
export async function encryptLibraryInnerBytes(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<{ salt: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array }> {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  const key = await deriveAesGcmKey(passphrase, salt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: copyToFixedBuffer(iv) },
    key,
    copyToFixedBuffer(plaintext),
  );
  return { salt, iv, ciphertext: new Uint8Array(cipherBuf) };
}

export async function decryptLibraryInnerBytes(
  ciphertext: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveAesGcmKey(passphrase, salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: copyToFixedBuffer(iv) },
    key,
    copyToFixedBuffer(ciphertext),
  );
  return new Uint8Array(plain);
}

export async function collectLibraryBackupPayload(
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<LibraryBackupPayload> {
  const storageBackend = await storageService.getStorageBackendKind();
  const projectIds = await storageService.listProjects();
  const projects: LibraryProjectBundle[] = [];
  let done = 0;
  const total = Math.max(1, projectIds.length * 3 + 2);

  onProgress?.('list', 0, total);

  for (const projectId of projectIds) {
    const project = await storageService.loadProject(projectId);
    const codex = await storageService.getStoryCodex(projectId);
    const ragVectors = await storageService.getRagVectors(projectId);
    const binderIds = await storageService.listBinderAssetIds(projectId);
    const binderAssets: LibraryProjectBundle['binderAssets'] = [];
    let bi = 0;
    for (const assetId of binderIds) {
      const payload = await storageService.getBinderAsset(projectId, assetId);
      if (payload) {
        binderAssets.push({
          assetId,
          meta: payload.meta,
          dataBase64: bytesToBase64(new Uint8Array(payload.data)),
        });
      }
      bi++;
      onProgress?.(`binder:${projectId}`, done + bi, total);
    }
    projects.push({
      projectId,
      project,
      storyCodex: codex,
      ragVectors,
      binderAssets,
    });
    done += 3;
    onProgress?.('project', done, total);
  }

  const settings = await storageService.loadSettings();
  done++;
  onProgress?.('settings', done, total);

  const snaps = await storageService.listSnapshots();
  const snapshots = [];
  for (const s of snaps) {
    const data = await storageService.getSnapshotData(s.id);
    snapshots.push({ id: s.id, date: s.date, name: s.name, wordCount: s.wordCount, data });
  }
  done++;
  onProgress?.('snapshots', done, total);

  return {
    format: LIBRARY_BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    storageBackend,
    settings,
    projects,
    snapshots,
  };
}

export interface EncryptedLibraryZipMeta {
  format: typeof LIBRARY_BACKUP_FORMAT;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  ivBase64: string;
  cipher: 'AES-GCM-256';
}

/** Builds a .zip with META.json + vault.bin (encrypted inner DEFLATE archive). */
export async function buildEncryptedLibraryZipBlob(
  passphrase: string,
  onProgress?: (phase: string, done: number, total: number) => void,
): Promise<Blob> {
  const payload = await collectLibraryBackupPayload(onProgress);
  const innerZip = new JSZip();
  // QNBS-v3: Klartext-JSON als String — JSZip schreibt UTF-8 zuverlässiger als rohes Uint8Array in dieser Version.
  innerZip.file('payload.json', JSON.stringify(payload));
  const innerBytes = await innerZip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const { salt, iv, ciphertext } = await encryptLibraryInnerBytes(innerBytes, passphrase);

  const meta: EncryptedLibraryZipMeta = {
    format: LIBRARY_BACKUP_FORMAT,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    cipher: 'AES-GCM-256',
  };

  const outer = new JSZip();
  outer.file('META.json', JSON.stringify(meta, null, 2));
  outer.file('vault.bin', ciphertext);

  return outer.generateAsync({
    type: 'blob',
    compression: 'STORE',
  });
}

/** Decode encrypted export for tests / future importer (does not restore into IDB). */
export async function decryptLibraryZipBlob(
  blob: Blob,
  passphrase: string,
): Promise<LibraryBackupPayload> {
  const outer = await JSZip.loadAsync(blob);
  const metaFile = outer.file('META.json');
  const vaultFile = outer.file('vault.bin');
  if (!metaFile || !vaultFile) {
    throw new Error('Invalid WorldScript library backup: missing META.json or vault.bin');
  }
  const meta = JSON.parse(await metaFile.async('string')) as EncryptedLibraryZipMeta;
  const ciphertext = await vaultFile.async('uint8array');
  const salt = base64ToBytes(meta.saltBase64);
  const iv = base64ToBytes(meta.ivBase64);
  const plain = await decryptLibraryInnerBytes(ciphertext, passphrase, salt, iv);
  const innerZip = await JSZip.loadAsync(plain);
  const payloadEntry = innerZip.file('payload.json');
  if (!payloadEntry) throw new Error('Invalid inner archive');
  const txt = await payloadEntry.async('string');
  return JSON.parse(txt) as LibraryBackupPayload;
}
