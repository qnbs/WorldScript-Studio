/**
 * FsCore — Shared Tauri FS utilities: API loader, retry, compress/decompress, crypto, path helpers.
 * QNBS-v3: Extracted from fileSystemService.ts. Base class owns appDataPath + API loading.
 */

import LZString from 'lz-string';
import { desktopPlatform } from '../desktopPlatform';
import { logger } from '../logger';

// QNBS-v3: delegates through desktopPlatform now, not @tauri-apps/* directly — shape unchanged, so the 5 fs-store consumers need zero call-site changes.
export type TauriApis = {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string, opts?: { createNew?: boolean }) => Promise<void>;
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
};

let tauriApis: TauriApis | null = null;

type LegacyAuxiliaryPolicy = {
  legacyProjectId: string;
  codex: boolean;
  binderAssetIds: ReadonlySet<string>;
};

export async function loadTauriApis(): Promise<TauriApis> {
  if (tauriApis) return tauriApis;
  if (!desktopPlatform.runtime.isDesktop) {
    throw new Error('Tauri APIs not available in this environment');
  }
  tauriApis = {
    readTextFile: (path) => desktopPlatform.filesystem.readTextFile(path),
    writeTextFile: (path, content, opts) =>
      desktopPlatform.filesystem.writeTextFile(path, content, opts),
    readFile: (path) =>
      desktopPlatform.filesystem.readFile(path) as Promise<Uint8Array<ArrayBuffer>>,
    writeFile: (path, data) => desktopPlatform.filesystem.writeFile(path, data),
    mkdir: (path, opts) => desktopPlatform.filesystem.mkdir(path, opts),
    exists: (path) => desktopPlatform.filesystem.exists(path),
    readDir: (path) => desktopPlatform.filesystem.readDir(path),
    remove: (path, opts) => desktopPlatform.filesystem.remove(path, opts),
    rename: (oldPath, newPath) => desktopPlatform.filesystem.rename(oldPath, newPath),
    open: (opts) => desktopPlatform.dialogs.openFilePicker(opts),
    save: (opts) => desktopPlatform.dialogs.saveFilePicker(opts),
    appDataDir: () => desktopPlatform.persistence.appDataDir(),
    join: (...parts) => desktopPlatform.persistence.join(...parts),
  };
  return tauriApis;
}

// --- Retry helper for transient filesystem errors ---

export async function retryFs<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // QNBS-v3 (#553): String(err), not err instanceof Error ? err.message : '' — the real Tauri invoke boundary rejects with a plain string, never a JS Error, so an instanceof-Error-only check saw an empty message for every real transient filesystem error and silently never retried it.
      const msg = String(err instanceof Error ? err.message : err).toLowerCase();
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
  beforeReplace?: () => void | Promise<void>,
): Promise<void> {
  const previous = atomicWriteTails.get(path);
  const current = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
    const temporary = temporaryPath(path);
    try {
      await retryFs(() => write(temporary));
      await retryFs(async () => {
        // QNBS-v3: admit immediately before every irreversible rename attempt, including retries after a transient filesystem failure.
        const admission = beforeReplace?.();
        // QNBS-v3: keep synchronous image admission adjacent to rename; only an asynchronous filesystem check may yield here.
        if (admission instanceof Promise) await admission;
        await apis.rename(temporary, path);
      });
    } catch (error) {
      // QNBS-v3: retry cleanup, then log (not throw) — the caller must always see the original write/rename error, with an orphaned-temp-file warning surfaced for diagnostics.
      try {
        await retryFs(() => apis.remove(temporary));
      } catch (cleanupError) {
        logger.warn('Failed to remove temp file after a failed atomic write', {
          path: temporary,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
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
export function writeTextFileAtomic(
  apis: TauriApis,
  path: string,
  content: string,
  beforeReplace?: () => void | Promise<void>,
): Promise<void> {
  return writeAndReplace(
    apis,
    path,
    (temporary) => apis.writeTextFile(temporary, content),
    beforeReplace,
  );
}

// QNBS-v3: binary assets use the same same-directory replace so readers never observe a partial file.
export function writeFileAtomic(apis: TauriApis, path: string, data: Uint8Array): Promise<void> {
  return writeAndReplace(apis, path, (temporary) => apis.writeFile(temporary, data));
}

// --- Cross-process project-file lock (#553) ---
// QNBS-v3: writeTextFileAtomic's beforeReplace re-check narrows but does not eliminate the TOCTOU gap between two OS processes (two app instances) each racing their own read-check-rename cycle against the same project file — this lock closes that gap by serializing the whole cycle behind an OS-level exclusive-create sibling file. Deliberately has NO time-based or ownership-token stale-lock reclaim: every such scheme was proven unsound during review (an owner token still can't make removal conditional on content — the path can change between the re-read and the remove call — and a lock file exists, per plugin-fs semantics, before its content is written, so a reader can observe an empty/malformed live lock and misclassify it as abandoned) — see #553 for tracked follow-up requiring real OS-level locking (flock or equivalent, which needs new Rust-side code) to recover a crashed writer's orphaned lock; until then, a genuinely stuck lock is out-of-band-recoverable only (restart clears in-process state; the file itself is never corrupted by this, only unsavable). This also means the guarantee below is scoped to writers that participate in this exact convention — a non-cooperating external tool (e.g. a sync client) that writes project.json directly without ever creating <path>.lock is not, and cannot be, fenced by an application-level file alone.

export class ProjectFileLockedError extends Error {
  constructor(path: string) {
    super(`project file is locked by another writer: ${path}`);
    this.name = 'ProjectFileLockedError';
  }
}

// QNBS-v3 (#553): the lock above serializes write ORDER only; this refuses a writer whose in-memory project descends from an older on-disk generation than the one now committed — overlaying its full snapshot onto the newer carrier would silently revert fields another WorldScript window changed. Distinct from lock contention: waiting never clears it, only reloading does.
export class StaleProjectWriterError extends Error {
  constructor(readonly projectId: string) {
    super(
      `project ${projectId} was changed by another WorldScript window after this window loaded it`,
    );
    this.name = 'StaleProjectWriterError';
  }
}

const LOCK_SUFFIX = '.lock';
const LOCK_ACQUIRE_ATTEMPTS = 3;
const LOCK_ACQUIRE_BACKOFF_MS = [200, 500];

// QNBS-v3 (#553): the one name for the stable sibling directory that holds every project's lock file, shared by projectFsStore.ts (which creates locks under it) and factoryResetService.ts (which must check it before wiping app data) — a second, independently-typed copy of this string in the latter would be exactly the kind of drift-prone duplication already flagged once in this PR.
export const PROJECT_LOCKS_DIR_NAME = 'project-locks';

function lockPathFor(path: string): string {
  return `${path}${LOCK_SUFFIX}`;
}

// QNBS-v3: distinguishes genuine lock contention from an unrelated filesystem failure (permission denied, missing parent directory, disk full) by checking actual filesystem state after a failed create, never by pattern-matching the error's message text — the real Tauri error embeds the full lock path (e.g. a project titled "Existential Novel" makes the message contain "exist" regardless of cause), so any substring/keyword match on it is spoofable by ordinary user-chosen project names and would misclassify a real, unrelated, recoverable failure as contention.
async function classifyFailedLockCreate(
  apis: TauriApis,
  lockPath: string,
  error: unknown,
): Promise<'contention' | 'unrelated'> {
  // QNBS-v3: a failed create classifies as contention only if something now demonstrably occupies the path — whether it was already there or is our own attempt's partial artifact, treating either as "do not touch" is the safe default; a check that failed to even determine this propagates the original error rather than guessing.
  let occupied: boolean;
  try {
    occupied = await apis.exists(lockPath);
  } catch {
    throw error;
  }
  return occupied ? 'contention' : 'unrelated';
}

// QNBS-v3 (#553): a bounded one-shot inline retry, not a loop — exists() coming back false right after a failed create does not prove the failure was unrelated to contention; the lock we just collided with may have been released by its owner's `finally` block in the instant between our failed create and this check, a real interleaving under ordinary two-window concurrent editing, not a contrived edge case. Immediately rethrowing that stale first error would surface a spurious permanent-looking failure for a path that is actually free again. One extra attempt closes that race: if the path really is free now, it succeeds; if the first failure truly was unrelated (permission denied, disk full, ...), this attempt fails the same way and *that* fresh error is what propagates, never the stale one. If the retry instead collides with a genuinely new lock, it is classified exactly like the first attempt — contention, handled by the caller's own bounded backoff loop — rather than being swallowed here.
async function tryCreateLock(apis: TauriApis, lockPath: string): Promise<boolean> {
  try {
    // QNBS-v3: empty content, not just unread by anything — verified against the pinned tauri-plugin-fs@2.5.2 Rust source: write_file's create_new open() and its data write_all() are two separate steps, and a write_all failure after a successful open leaves the just-created file orphaned with no cleanup. write_all on an empty buffer never issues an OS write syscall at all (its loop condition is false immediately), so it cannot itself fail once open() has already succeeded — an empty payload therefore closes this gap rather than merely narrowing it, leaving only open()'s own already-proven-atomic create_new as a failure point.
    await apis.writeTextFile(lockPath, '', { createNew: true });
    return true;
  } catch (firstError) {
    if ((await classifyFailedLockCreate(apis, lockPath, firstError)) === 'contention') {
      return false;
    }
    try {
      await apis.writeTextFile(lockPath, '', { createNew: true });
      return true;
    } catch (secondError) {
      if ((await classifyFailedLockCreate(apis, lockPath, secondError)) === 'contention') {
        return false;
      }
      throw secondError;
    }
  }
}

/**
 * Serializes an operation against a project file across OS processes via an exclusive-create
 * sibling lock file. Bounded retry only, never an unbounded wait, and never removes a lock it did
 * not itself create — see the module-level comment above for why every reclaim strategy considered
 * was unsound. A genuinely held lock (including one abandoned by a crashed writer) surfaces as
 * ProjectFileLockedError, which flows into the caller's existing retry-next-cycle error handling.
 */
export async function withProjectFileLock<T>(
  apis: TauriApis,
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = lockPathFor(path);
  let acquired = false;
  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt++) {
    acquired = await tryCreateLock(apis, lockPath);
    if (acquired) break;
    if (attempt < LOCK_ACQUIRE_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_ACQUIRE_BACKOFF_MS[attempt]));
    }
  }
  if (!acquired) {
    throw new ProjectFileLockedError(path);
  }
  try {
    return await fn();
  } finally {
    try {
      // QNBS-v3: retryFs, not a bare remove — a single transient release failure (e.g. Windows briefly reporting the file busy) must not turn into the same permanent, unrecoverable lock this module has no reclaim path for.
      await retryFs(() => apis.remove(lockPath));
    } catch (error) {
      logger.warn('Failed to release project file lock; it will block saves until removed', {
        path: lockPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// --- LZ-String compression (mirrors dbService threshold and prefix) ---

const COMPRESS_THRESHOLD = 10_240;
const LZ_PREFIX = '\x00lz1\x00';

export function compressData<T>(data: T): string {
  return compressJsonText(JSON.stringify(data));
}

/** Compresses already-serialized JSON without parsing or reserializing its raw tokens. */
export function compressJsonText(json: string): string {
  if (json.length < COMPRESS_THRESHOLD) return json;
  return LZ_PREFIX + LZString.compressToUTF16(json);
}

// QNBS-v3: lz-string returns null (never throws) on corrupt/truncated input — silently substituting '{}' masked real corruption as a valid empty object (DA-01); throw instead so callers can fail closed.
export class DecompressionError extends Error {
  constructor(message = 'Failed to decompress stored data — the payload is corrupt or truncated.') {
    super(message);
    this.name = 'DecompressionError';
  }
}

/**
 * Decodes a stored payload while retaining the decompressed JSON text as the lossless admission
 * input. The typed helper below remains the compatibility path for non-project stores.
 */
export function decompressJsonText(raw: string): string {
  let json = raw;
  if (raw.startsWith(LZ_PREFIX)) {
    const decompressed = LZString.decompressFromUTF16(raw.slice(LZ_PREFIX.length));
    if (decompressed === null) {
      throw new DecompressionError();
    }
    json = decompressed;
  }
  return json;
}

// QNBS-v3: JSON.parse also wrapped — a bare SyntaxError would break the DecompressionError-only contract callers rely on.
export function decompressData<T>(raw: string): T {
  try {
    return JSON.parse(decompressJsonText(raw)) as T;
  } catch {
    throw new DecompressionError(
      raw.startsWith(LZ_PREFIX)
        ? 'Failed to parse decompressed data as JSON — the payload is corrupt.'
        : 'Failed to parse stored data as JSON — the payload is corrupt.',
    );
  }
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
  private readonly legacyAuxiliaryPolicies = new Map<string, LegacyAuxiliaryPolicy>();
  private legacyRoutingOperationTail: Promise<void> | null = null;
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

  // QNBS-v3: subclasses re-evaluate project authority only after the serialized operation begins.
  protected async assertProjectWriteAuthority(_projectId: string): Promise<void> {}

  protected isProjectWriteAuthorityError(_error: unknown): boolean {
    return false;
  }

  // QNBS-v3 (#553): subclasses refuse an auxiliary write from a window whose editable project no longer matches disk.
  protected runFencedAuxiliaryWrite<T>(
    _projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  // QNBS-v3 (#553): user-facing image/binder/codex mutations take the same stale-writer fence as saveProject; rollback, import and project-delete internals deliberately bypass it.
  protected withAuxiliaryWriteOperation<T>(
    operation: () => Promise<T>,
    projectId: string,
  ): Promise<T> {
    return this.withLegacyRoutingOperation(
      () => this.runFencedAuxiliaryWrite(projectId, operation),
      projectId,
    );
  }

  // QNBS-v3: serialize complete filesystem operations so legacy route ownership cannot change between awaited mutations.
  protected async withLegacyRoutingOperation<T>(
    operation: () => Promise<T>,
    projectId?: string,
  ): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.legacyRoutingOperationTail;
    const current = (previous?.catch(() => undefined) ?? Promise.resolve()).then(() => gate);
    this.legacyRoutingOperationTail = current;
    await previous;
    try {
      if (projectId !== undefined) {
        await this.assertProjectWriteAuthority(projectId);
      }
      return await operation();
    } finally {
      if (this.legacyRoutingOperationTail === current) {
        this.legacyRoutingOperationTail = null;
      }
      release();
    }
  }

  protected registerLegacyAuxiliaryPolicy(
    projectId: string,
    legacyProjectId: string,
    policy: Omit<LegacyAuxiliaryPolicy, 'legacyProjectId'>,
  ): void {
    if (policy.codex || policy.binderAssetIds.size > 0) {
      // QNBS-v3: one filesystem-owned policy keeps verified legacy auxiliary data addressable without cross-project fallback.
      this.legacyAuxiliaryPolicies.set(projectId, { legacyProjectId, ...policy });
    }
  }

  protected clearLegacyAuxiliaryPolicy(projectId: string): void {
    this.legacyAuxiliaryPolicies.delete(projectId);
  }

  // QNBS-v3: quarantine can persist only the verified route, never ambiguous fallback contents, for later recovery.
  protected legacyAuxiliaryPolicyForProject(projectId: string): {
    legacyProjectId: string;
    codex: boolean;
    binderAssetIds: readonly string[];
  } | null {
    const policy = this.policyFor(projectId);
    if (!policy) return null;
    return {
      legacyProjectId: policy.legacyProjectId,
      codex: policy.codex,
      binderAssetIds: [...policy.binderAssetIds],
    };
  }

  // QNBS-v3: claiming a real project directory invalidates legacy routes targeting that directory before they can redirect another project into it.
  protected clearLegacyPoliciesTargetingProject(projectId: string): void {
    const safeProjectId = sanitizePathSegment(projectId, '');
    if (!safeProjectId || safeProjectId === '.' || safeProjectId === '..') return;
    for (const [policyProjectId, policy] of this.legacyAuxiliaryPolicies) {
      if (policy.legacyProjectId === safeProjectId) {
        this.legacyAuxiliaryPolicies.delete(policyProjectId);
      }
    }
  }

  private policyFor(projectId: string): LegacyAuxiliaryPolicy | undefined {
    const safeProjectId = sanitizePathSegment(projectId, '');
    if (!safeProjectId || safeProjectId === '.' || safeProjectId === '..') return undefined;
    return this.legacyAuxiliaryPolicies.get(safeProjectId);
  }

  protected resolveAuxiliaryProjectId(
    projectId: string,
    kind: 'binder' | 'codex',
    assetId?: string,
  ): string {
    const policy = this.policyFor(projectId);
    if (!policy) return projectId;
    if (kind === 'codex' && policy.codex) return policy.legacyProjectId;
    if (kind === 'binder' && assetId && policy.binderAssetIds.has(assetId)) {
      return policy.legacyProjectId;
    }
    return projectId;
  }

  protected legacyBinderProjectId(projectId: string): string | null {
    const policy = this.policyFor(projectId);
    return policy && policy.binderAssetIds.size > 0 ? policy.legacyProjectId : null;
  }

  protected legacyCodexProjectId(projectId: string): string | null {
    const policy = this.policyFor(projectId);
    return policy?.codex ? policy.legacyProjectId : null;
  }

  protected legacyBinderAssetIdsForProject(projectId: string): readonly string[] {
    return [...(this.policyFor(projectId)?.binderAssetIds ?? [])];
  }
}
