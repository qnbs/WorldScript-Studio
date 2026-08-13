/**
 * Desktop fs-backed protected-data migration bridge. `services/storage/storageEncryptionService.ts`'s
 * setupIdbEncryption()/clearIdbPassphrase()/rotateIdbPassphrase() own the shared salt/sentinel/
 * session key but have no awareness that services/fs/* (Tauri desktop project data + API keys)
 * depends on that same key material via protectTextValue()/unprotectTextValue() (see fsCore.ts).
 * Left uncoordinated: a first-time setup would report "encryption active" while every
 * already-existing file stays plaintext until its next incidental save; a disable would destroy
 * the sentinel while fs-backed files stay encrypted under the now-unrecoverable old key; a rotate
 * would swap the active key while fs-backed files stay under the old one. All three permanently
 * strand or misrepresent desktop project data. This module converges every fs-backed file to the
 * state implied by targetKey (encrypt under it, re-key to it, or decrypt to plaintext when null)
 * and must run to completion BEFORE the sentinel/active key is set up, destroyed, or swapped.
 * QNBS-v3 (F-05/F-06 follow-up, 2026-08-13): callers must gate on isTauriRuntime() — a no-op cost
 * on web, since fs-backed files simply don't exist there.
 */

import { logger } from '../logger';
import { idbEncryptWithKey } from '../storage/storageEncryptionService';
import {
  bytesToBase64,
  loadTauriApis,
  type TauriApis,
  unprotectTextValue,
  writeTextFileAtomic,
} from './fsCore';
import { fileSystemService } from './index';

const PROTECTED_TEXT_SCHEME = 'protected-v1';

interface MigrationOptions {
  targetKey: CryptoKey | null;
  // QNBS-v3: every lifecycle operation is strict, so setup never reports complete encryption while a pre-existing file remains plaintext or unreadable.
  strict: true;
}

// QNBS-v3: an exists() check first separates "genuinely absent" (always safe to skip — e.g. config/ not yet created on a fresh install) from "present but unreadable" (a real error that must propagate in strict mode, or be logged-and-skipped in non-strict mode — never silently treated as empty).
async function listDirEntries(
  apis: TauriApis,
  dir: string,
  strict: boolean,
): Promise<{ name?: string; isDirectory?: boolean }[]> {
  if (!(await apis.exists(dir))) return [];
  try {
    return await apis.readDir(dir);
  } catch (error) {
    if (strict) throw error;
    logger.warn(`Skipping directory ${dir} — could not list its contents:`, error);
    return [];
  }
}

// QNBS-v3: no persistent per-file journal/checkpoint yet (tracked in issue #359) — a process kill mid-rotate can leave a mixed-key state; this marker can't resume/fix that but converts it into a detected one.
const MIGRATION_MARKER_FILENAME = 'fs-migration-marker.json';

export interface FsMigrationMarker {
  operation: 'set' | 'disable' | 'rotate';
  startedAt: string;
}

export class FsMigrationInterruptedError extends Error {
  readonly code = 'FS_ENCRYPTION_MIGRATION_INTERRUPTED' as const;

  constructor(readonly marker: FsMigrationMarker) {
    super(`Desktop filesystem encryption ${marker.operation} migration was interrupted`);
    this.name = 'FsMigrationInterruptedError';
  }
}

async function writeMigrationMarker(
  apis: TauriApis,
  appDataPath: string,
  operation: FsMigrationMarker['operation'],
): Promise<void> {
  const configPath = await apis.join(appDataPath, 'config');
  if (!(await apis.exists(configPath))) await apis.mkdir(configPath, { recursive: true });
  const markerPath = await apis.join(configPath, MIGRATION_MARKER_FILENAME);
  const marker: FsMigrationMarker = { operation, startedAt: new Date().toISOString() };
  await writeTextFileAtomic(apis, markerPath, JSON.stringify(marker));
}

/**
 * Clears the marker written by migrateAllProtectedFsData(). Deliberately NOT called automatically
 * at the end of migrateAllProtectedFsData itself — for disable/rotate, an IDB-side commit
 * (clearIdbPassphrase()/rotateIdbPassphrase()) still has to run after the fs bridge succeeds, and
 * clearing this marker before that commit would erase the only "an operation is mid-flight"
 * signal a process kill in that remaining window would leave behind. Callers (useSettingsView.ts)
 * call this only once the ENTIRE operation — fs bridge AND any subsequent IDB commit — succeeds.
 */
export async function clearFsMigrationMarker(): Promise<void> {
  const apis = await loadTauriApis();
  const appDataPath = await apis.appDataDir();
  const markerPath = await apis.join(appDataPath, 'config', MIGRATION_MARKER_FILENAME);
  try {
    await apis.remove(markerPath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes('not found') && !message.includes('enoent')) throw error;
  }
}

/**
 * Returns the marker left by an fs-data migration that never reached completion (crash, forced
 * quit, power loss mid-operation), or null if none exists. Startup checks this before persisted
 * state hydration, so a mixed-key state cannot be mistaken for a first-run library — see #359.
 */
export async function checkForInterruptedFsMigration(): Promise<FsMigrationMarker | null> {
  const apis = await loadTauriApis();
  const appDataPath = await apis.appDataDir();
  const markerPath = await apis.join(appDataPath, 'config', MIGRATION_MARKER_FILENAME);
  if (!(await apis.exists(markerPath))) return null;
  const marker = JSON.parse(await apis.readTextFile(markerPath)) as Partial<FsMigrationMarker>;
  if (
    (marker.operation !== 'set' &&
      marker.operation !== 'disable' &&
      marker.operation !== 'rotate') ||
    typeof marker.startedAt !== 'string'
  ) {
    throw new Error('Desktop filesystem encryption migration marker is malformed');
  }
  return marker as FsMigrationMarker;
}

/** Block persistence hydration until a previously interrupted filesystem migration is recovered. */
export async function assertNoInterruptedFsMigration(): Promise<void> {
  const marker = await checkForInterruptedFsMigration();
  if (marker) throw new FsMigrationInterruptedError(marker);
}

/**
 * Converges a single whole-file-protected text file (project.json / settings.json / codex.snap /
 * vectors.snap / images/*.png) to the state implied by opts.targetKey: encrypts it under the key
 * (covers both first-time setup, where every file starts plaintext, and rotate, where it may
 * already be protected under a different key), or unwraps it to plain text when targetKey is
 * null (disable). No-ops when the file is absent or already in the desired target state.
 */
async function reprotectWholeFile(
  apis: TauriApis,
  path: string,
  opts: MigrationOptions,
): Promise<void> {
  // QNBS-v3: exists() first — a read failure on a file that DOES exist must propagate, not be conflated with "never existed".
  if (!(await apis.exists(path))) return;
  let raw: string;
  try {
    raw = await apis.readTextFile(path);
  } catch (error) {
    if (opts.strict) throw error;
    logger.warn(`Skipping ${path} — could not read it:`, error);
    return;
  }
  let plaintext: string;
  try {
    plaintext = await unprotectTextValue(raw);
  } catch (error) {
    if (opts.strict) throw error;
    logger.warn(`Skipping ${path} — could not read its current content:`, error);
    return;
  }
  const content = opts.targetKey
    ? JSON.stringify({
        scheme: PROTECTED_TEXT_SCHEME,
        data: bytesToBase64(await idbEncryptWithKey(opts.targetKey, plaintext)),
      })
    : plaintext;
  if (content === raw) return; // already in the desired state
  try {
    await writeTextFileAtomic(apis, path, content);
  } catch (error) {
    if (opts.strict) throw error;
    logger.warn(`Skipping ${path} — could not write its new protected state:`, error);
  }
}

interface SnapshotEnvelopeShape {
  data?: unknown;
  [key: string]: unknown;
}

/** Re-keys only the value-level-protected `data` field inside a snapshot envelope file. */
async function reprotectSnapshotFile(
  apis: TauriApis,
  path: string,
  opts: MigrationOptions,
): Promise<void> {
  if (!(await apis.exists(path))) return;
  let raw: string;
  try {
    raw = await apis.readTextFile(path);
  } catch (error) {
    if (opts.strict) throw error;
    logger.warn(`Skipping ${path} — could not read it:`, error);
    return;
  }
  let envelope: SnapshotEnvelopeShape;
  try {
    envelope = JSON.parse(raw) as SnapshotEnvelopeShape;
  } catch {
    return; // legacy raw-project-data snapshot format predates the envelope — never protected
  }
  if (typeof envelope.data !== 'string') return;
  const originalData = envelope.data;
  let plaintext: string;
  try {
    plaintext = await unprotectTextValue(originalData);
  } catch (error) {
    if (opts.strict) throw error;
    logger.warn(`Skipping ${path} — could not read its current data field:`, error);
    return;
  }
  envelope.data = opts.targetKey
    ? JSON.stringify({
        scheme: PROTECTED_TEXT_SCHEME,
        data: bytesToBase64(await idbEncryptWithKey(opts.targetKey, plaintext)),
      })
    : plaintext;
  if (envelope.data === originalData) return; // already in the desired state
  try {
    await writeTextFileAtomic(apis, path, JSON.stringify(envelope));
  } catch (error) {
    if (opts.strict) throw error;
    logger.warn(`Skipping ${path} — could not write its new protected state:`, error);
  }
}

/**
 * Converges every fs-backed protected file to targetKey (first-time setup or rotate) or to
 * plaintext (targetKey=null, disable). Every operation is strict: a read, decrypt, enumeration, or
 * write failure leaves the durable marker in place and reports failure rather than claiming complete
 * desktop protection. The caller clears the marker only after the subsequent IDB lifecycle commit.
 */
export async function migrateAllProtectedFsData(
  targetKey: CryptoKey | null,
  operation: FsMigrationMarker['operation'],
): Promise<void> {
  const opts: MigrationOptions = { targetKey, strict: true };
  const apis = await loadTauriApis();
  const appDataPath = await apis.appDataDir();

  await writeMigrationMarker(apis, appDataPath, operation);

  const configPath = await apis.join(appDataPath, 'config');
  const configEntries = await listDirEntries(apis, configPath, opts.strict);
  for (const entry of configEntries) {
    if (!entry.name || entry.isDirectory) continue;
    if (entry.name === 'settings.json') {
      const entryPath = await apis.join(configPath, entry.name);
      await reprotectWholeFile(apis, entryPath, opts);
    } else if (entry.name.endsWith('_key.enc.json')) {
      const provider = entry.name.slice(0, -'_key.enc.json'.length);
      await fileSystemService.reprotectApiKeyFile(provider, opts.targetKey, opts.strict);
    }
  }

  const snapshotsPath = await apis.join(appDataPath, 'snapshots');
  const snapshotEntries = await listDirEntries(apis, snapshotsPath, opts.strict);
  for (const entry of snapshotEntries) {
    if (!entry.name?.endsWith('.json')) continue;
    const filePath = await apis.join(snapshotsPath, entry.name);
    await reprotectSnapshotFile(apis, filePath, opts);
  }

  const imagesPath = await apis.join(appDataPath, 'images');
  const imageEntries = await listDirEntries(apis, imagesPath, opts.strict);
  for (const entry of imageEntries) {
    if (!entry.name?.endsWith('.png')) continue;
    const filePath = await apis.join(imagesPath, entry.name);
    await reprotectWholeFile(apis, filePath, opts);
  }

  // QNBS-v3: uses listDirEntries (not fileSystemService.listProjects(), which swallows every readDir failure to []) — a transient permission/I/O error enumerating projects/ must abort strict-mode migrations, not silently skip every project/Codex/vector file while still reporting success.
  const projectsPath = await apis.join(appDataPath, 'projects');
  const projectEntries = await listDirEntries(apis, projectsPath, opts.strict);
  for (const entry of projectEntries) {
    if (!entry.name) continue;
    const projectDir = await apis.join(projectsPath, entry.name);
    await reprotectWholeFile(apis, await apis.join(projectDir, 'project.json'), opts);
    const codexDir = await apis.join(projectDir, 'codex');
    await reprotectWholeFile(apis, await apis.join(codexDir, 'codex.snap'), opts);
    await reprotectWholeFile(apis, await apis.join(codexDir, 'vectors.snap'), opts);
  }
}

// QNBS-v3: both resetAllDatabases() (storage-init-failure recovery) and wipeAllAppData() (factory
// reset) previously deleted only IDB + localStorage (including the KDF salt) without touching this
// filesystem backend — any already-protected fs file became permanently undecryptable ciphertext
// orphaned on disk, since the salt is required to re-derive any key, even with the right passphrase.
const RESETTABLE_TOP_LEVEL_DIRS = ['projects', 'config', 'snapshots', 'images'] as const;

/**
 * Deletes every fs-backed store's data (projects, settings, API keys, snapshots, images). No-op
 * outside the Tauri runtime — callers should still gate on isTauriRuntime() themselves so this
 * import doesn't need to be reached at all on web. Deliberately called BEFORE the salt/sentinel is
 * erased by the caller: if this throws partway through, the salt/sentinel are still intact, so no
 * remaining file becomes stranded — only a full, unconditional erase of both sides together is safe.
 */
export async function deleteAllFsData(): Promise<void> {
  const apis = await loadTauriApis();
  const appDataPath = await apis.appDataDir();
  for (const dir of RESETTABLE_TOP_LEVEL_DIRS) {
    const dirPath = await apis.join(appDataPath, dir);
    if (await apis.exists(dirPath)) {
      await apis.remove(dirPath, { recursive: true });
    }
  }
}
