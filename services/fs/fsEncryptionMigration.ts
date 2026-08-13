/**
 * Desktop fs-backed protected-data migration bridge. `services/storage/storageEncryptionService.ts`'s
 * clearIdbPassphrase()/rotateIdbPassphrase() own the shared salt/sentinel/session key but have no
 * awareness that services/fs/* (Tauri desktop project data + API keys) depends on that same key
 * material via protectTextValue()/unprotectTextValue() (see fsCore.ts). Left uncoordinated, a
 * disable would destroy the sentinel while fs-backed files stay encrypted under the now-unrecoverable
 * old key; a rotate would swap the active key while fs-backed files stay under the old one — both
 * permanently stranding desktop project data. This module must run to completion BEFORE either of
 * those functions touches the sentinel/active key, using the still-valid OLD session key.
 * QNBS-v3 (F-05/F-06 follow-up, 2026-08-13): callers must gate on isTauriRuntime() — a no-op cost
 * on web, since fs-backed files simply don't exist there.
 */

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

/**
 * Re-keys a single whole-file-protected text file (project.json / settings.json / codex.snap /
 * vectors.snap / images/*.png) under targetKey, or unwraps it to plain text when targetKey is
 * null (disable). No-ops when the file is absent or not currently protected — unprotectTextValue()
 * returns its input completely unchanged in that case, detected here via reference equality, so no
 * envelope-shape knowledge needs to be duplicated from fsCore.ts.
 */
async function reprotectWholeFile(
  apis: TauriApis,
  path: string,
  targetKey: CryptoKey | null,
): Promise<void> {
  const raw = await apis.readTextFile(path).catch(() => null);
  if (raw === null) return;
  const plaintext = await unprotectTextValue(raw);
  if (plaintext === raw) return; // not a protected envelope — nothing to migrate
  const content = targetKey
    ? JSON.stringify({
        scheme: PROTECTED_TEXT_SCHEME,
        data: bytesToBase64(await idbEncryptWithKey(targetKey, plaintext)),
      })
    : plaintext;
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
  targetKey: CryptoKey | null,
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
  const plaintext = await unprotectTextValue(envelope.data);
  if (plaintext === envelope.data) return; // data field wasn't protected
  envelope.data = targetKey
    ? JSON.stringify({
        scheme: PROTECTED_TEXT_SCHEME,
        data: bytesToBase64(await idbEncryptWithKey(targetKey, plaintext)),
      })
    : plaintext;
  await writeTextFileAtomic(apis, path, JSON.stringify(envelope));
}

/**
 * Converts every fs-backed protected file to targetKey (rotate) or to plaintext (targetKey=null,
 * disable). Any positively-identified protected file that fails to decrypt under the current
 * session key throws immediately rather than being skipped — a partial migration must never
 * silently strand a file at a key that's about to become unrecoverable; the caller's disable/
 * rotate action fails safely (nothing changed) rather than completing with lost data.
 */
export async function migrateAllProtectedFsData(targetKey: CryptoKey | null): Promise<void> {
  const apis = await loadTauriApis();
  const appDataPath = await apis.appDataDir();

  const configPath = await apis.join(appDataPath, 'config');
  const configEntries = await listDirEntries(apis, configPath);
  await Promise.all(
    configEntries.map(async (entry) => {
      if (!entry.name || entry.isDirectory) return;
      if (entry.name === 'settings.json') {
        const entryPath = await apis.join(configPath, entry.name);
        await reprotectWholeFile(apis, entryPath, targetKey);
      } else if (entry.name.endsWith('_key.enc.json')) {
        const provider = entry.name.slice(0, -'_key.enc.json'.length);
        await fileSystemService.reprotectApiKeyFile(provider, targetKey);
      }
    }),
  );

  const snapshotsPath = await apis.join(appDataPath, 'snapshots');
  const snapshotEntries = await listDirEntries(apis, snapshotsPath);
  await Promise.all(
    snapshotEntries.map(async (entry) => {
      if (!entry.name?.endsWith('.json')) return;
      const filePath = await apis.join(snapshotsPath, entry.name);
      await reprotectSnapshotFile(apis, filePath, targetKey);
    }),
  );

  const imagesPath = await apis.join(appDataPath, 'images');
  const imageEntries = await listDirEntries(apis, imagesPath);
  await Promise.all(
    imageEntries.map(async (entry) => {
      if (!entry.name?.endsWith('.png')) return;
      const filePath = await apis.join(imagesPath, entry.name);
      await reprotectWholeFile(apis, filePath, targetKey);
    }),
  );

  const projectIds = await fileSystemService.listProjects();
  await Promise.all(
    projectIds.map(async (projectId) => {
      const projectDir = await apis.join(appDataPath, 'projects', projectId);
      await reprotectWholeFile(apis, await apis.join(projectDir, 'project.json'), targetKey);
      const codexDir = await apis.join(projectDir, 'codex');
      await reprotectWholeFile(apis, await apis.join(codexDir, 'codex.snap'), targetKey);
      await reprotectWholeFile(apis, await apis.join(codexDir, 'vectors.snap'), targetKey);
    }),
  );
}
