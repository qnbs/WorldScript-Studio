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
  // QNBS-v3: strict=true (disable/rotate) aborts the whole operation on any decrypt failure — the
  // caller is about to destroy/replace the only key that could ever decrypt a stranded file, so a
  // failure here must block the operation rather than complete with data silently left behind.
  // strict=false (first-time setup) logs and skips the offending file instead — nothing valuable
  // is being destroyed by turning encryption on, and a stray already-protected file (e.g. a
  // leftover from a previous, since-forgotten encryption session) must not block the user from
  // protecting everything else.
  strict: boolean;
}

async function listDirEntries(
  apis: TauriApis,
  dir: string,
): Promise<{ name?: string; isDirectory?: boolean }[]> {
  try {
    return await apis.readDir(dir);
  } catch {
    return []; // directory may not exist yet — nothing to migrate under it
  }
}

// QNBS-v3: this bridge re-keys files directly with no persistent per-file journal/checkpoint (the
// IDB migration path has one; this doesn't yet — tracked in issue #359). A process kill mid-rotate
// can leave some files under the new key while the durable sentinel still reflects the old one. The
// marker below can't resume or fix that, but it converts a silent mixed-key state into a detected
// one: written before migration starts, cleared only on full success, checked at next startup.
const MIGRATION_MARKER_FILENAME = 'fs-migration-marker.json';

interface FsMigrationMarker {
  operation: 'set' | 'disable' | 'rotate';
  startedAt: string;
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

async function clearMigrationMarker(apis: TauriApis, appDataPath: string): Promise<void> {
  const markerPath = await apis.join(appDataPath, 'config', MIGRATION_MARKER_FILENAME);
  await apis.remove(markerPath).catch(() => {});
}

/**
 * Returns the marker left by an fs-data migration that never reached completion (crash, forced
 * quit, power loss mid-operation), or null if none exists. Called once at startup
 * (FsCore.initialize()) to surface an honest warning rather than silently proceeding as if
 * nothing happened — see issue #359 for the real fix (a resumable, journaled migration).
 */
export async function checkForInterruptedFsMigration(): Promise<FsMigrationMarker | null> {
  try {
    const apis = await loadTauriApis();
    const appDataPath = await apis.appDataDir();
    const markerPath = await apis.join(appDataPath, 'config', MIGRATION_MARKER_FILENAME);
    if (!(await apis.exists(markerPath))) return null;
    const content = await apis.readTextFile(markerPath);
    return JSON.parse(content) as FsMigrationMarker;
  } catch {
    return null;
  }
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
  const raw = await apis.readTextFile(path).catch(() => null);
  if (raw === null) return;
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
  await writeTextFileAtomic(apis, path, content);
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
  const raw = await apis.readTextFile(path).catch(() => null);
  if (raw === null) return;
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
  await writeTextFileAtomic(apis, path, JSON.stringify(envelope));
}

/**
 * Converges every fs-backed protected file to targetKey (first-time setup or rotate) or to
 * plaintext (targetKey=null, disable). For 'disable'/'rotate', any positively-identified protected
 * file that fails to decrypt under the current session key throws immediately rather than being
 * skipped, so a partial migration can never silently strand a file at a key that's about to become
 * unrecoverable. For 'set', such a file is logged and left untouched instead, so an unrelated
 * pre-existing oddity can't block the user from enabling encryption for everything else. Writes a
 * durable marker before starting and clears it only on full success — see
 * checkForInterruptedFsMigration() and issue #359.
 */
export async function migrateAllProtectedFsData(
  targetKey: CryptoKey | null,
  operation: FsMigrationMarker['operation'],
): Promise<void> {
  const opts: MigrationOptions = { targetKey, strict: operation !== 'set' };
  const apis = await loadTauriApis();
  const appDataPath = await apis.appDataDir();

  await writeMigrationMarker(apis, appDataPath, operation);

  const configPath = await apis.join(appDataPath, 'config');
  const configEntries = await listDirEntries(apis, configPath);
  await Promise.all(
    configEntries.map(async (entry) => {
      if (!entry.name || entry.isDirectory) return;
      if (entry.name === 'settings.json') {
        const entryPath = await apis.join(configPath, entry.name);
        await reprotectWholeFile(apis, entryPath, opts);
      } else if (entry.name.endsWith('_key.enc.json')) {
        const provider = entry.name.slice(0, -'_key.enc.json'.length);
        await fileSystemService.reprotectApiKeyFile(provider, opts.targetKey, opts.strict);
      }
    }),
  );

  const snapshotsPath = await apis.join(appDataPath, 'snapshots');
  const snapshotEntries = await listDirEntries(apis, snapshotsPath);
  await Promise.all(
    snapshotEntries.map(async (entry) => {
      if (!entry.name?.endsWith('.json')) return;
      const filePath = await apis.join(snapshotsPath, entry.name);
      await reprotectSnapshotFile(apis, filePath, opts);
    }),
  );

  const imagesPath = await apis.join(appDataPath, 'images');
  const imageEntries = await listDirEntries(apis, imagesPath);
  await Promise.all(
    imageEntries.map(async (entry) => {
      if (!entry.name?.endsWith('.png')) return;
      const filePath = await apis.join(imagesPath, entry.name);
      await reprotectWholeFile(apis, filePath, opts);
    }),
  );

  const projectIds = await fileSystemService.listProjects();
  await Promise.all(
    projectIds.map(async (projectId) => {
      const projectDir = await apis.join(appDataPath, 'projects', projectId);
      await reprotectWholeFile(apis, await apis.join(projectDir, 'project.json'), opts);
      const codexDir = await apis.join(projectDir, 'codex');
      await reprotectWholeFile(apis, await apis.join(codexDir, 'codex.snap'), opts);
      await reprotectWholeFile(apis, await apis.join(codexDir, 'vectors.snap'), opts);
    }),
  );

  // QNBS-v3: only reached if every step above completed without throwing — a strict-mode abort or
  // a process kill both leave the marker in place, which is the intended "interrupted" signal.
  await clearMigrationMarker(apis, appDataPath);
}
