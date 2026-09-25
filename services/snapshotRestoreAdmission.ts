/**
 * Snapshot-restore admission for backends without their own restore authority (IndexedDB) — #553 §2.8.
 *
 * The filesystem backend admits a snapshot inside `FsProjectStore.restoreSnapshot`. IndexedDB used to
 * hand the stored snapshot object straight to the editor, so a FUTURE, MALFORMED or foreign-project
 * snapshot could enter editable state unchecked. This applies the same canonical admission and
 * owner check before anything is returned. Persisting the restored project afterwards is the
 * ordinary save path (a same-ID replacement — #553 a10), not part of this admission.
 */

import { CURRENT_PROJECT_SCHEMA_VERSION } from '../features/project/projectSchemaVersion';
import { ProjectSnapshotRestoreError } from './fs/projectFsStore';
import { admitCanonicalProjectDocument } from './projectDocument';
import { importedProjectJsonSchema } from './projectImportSchema';
import type { SnapshotRestoreTarget } from './storageBackend';

function projectIdOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as Record<string, unknown>)['id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

function serializeStructuredSnapshot(snapshot: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(snapshot);
  } catch {
    throw new ProjectSnapshotRestoreError('snapshot-invalid');
  }
  if (typeof text !== 'string') throw new ProjectSnapshotRestoreError('snapshot-unavailable');
  return text;
}

// QNBS-v3 (#553 §2.8): the whole stored object is admitted (opaque fields kept) and a pre-version snapshot is stamped CURRENT in memory only.
function admitSnapshotText(text: string): Record<string, unknown> {
  const admission = admitCanonicalProjectDocument(text, importedProjectJsonSchema);
  if (admission.status === 'REFUSED' || admission.canonical === null) {
    throw new ProjectSnapshotRestoreError('snapshot-invalid');
  }
  return JSON.parse(admission.canonical.raw) as Record<string, unknown>;
}

// QNBS-v3 (#553 §2.8): same rule as the filesystem restore — ownership must be proven by matching ids; two missing ids prove nothing and fail closed.
function verifySnapshotOwner(snapshot: unknown, currentProject: SnapshotRestoreTarget): void {
  const snapshotId = projectIdOf(snapshot);
  const targetId = projectIdOf(currentProject);
  if (snapshotId === null || targetId === null) {
    throw new ProjectSnapshotRestoreError('snapshot-owner-unverifiable');
  }
  if (snapshotId !== targetId) throw new ProjectSnapshotRestoreError('snapshot-owner-mismatch');
}

export function admitStructuredSnapshotRestore(
  snapshot: unknown,
  currentProject: SnapshotRestoreTarget,
): Record<string, unknown> {
  const admitted = admitSnapshotText(serializeStructuredSnapshot(snapshot));
  verifySnapshotOwner(admitted, currentProject);
  return { ...admitted, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION };
}
