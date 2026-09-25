/**
 * Snapshot-restore admission for backends without their own restore authority (IndexedDB) — #553 §2.8.
 *
 * The filesystem backend admits a snapshot inside `FsProjectStore.restoreSnapshot`. IndexedDB used to
 * hand the stored snapshot object straight to the editor, so a FUTURE, MALFORMED or foreign-project
 * snapshot could enter editable state unchecked. This applies the same canonical admission and
 * owner check before anything is returned.
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

// QNBS-v3 (#553 §2.8): IndexedDB stores snapshots as structured values, so the whole stored object is admitted (opaque fields kept) and a pre-version snapshot is stamped CURRENT in memory; the snapshot must belong to the project it replaces.
export function admitStructuredSnapshotRestore(
  snapshot: unknown,
  currentProject: SnapshotRestoreTarget,
): Record<string, unknown> {
  let text: string;
  try {
    text = JSON.stringify(snapshot);
  } catch {
    throw new ProjectSnapshotRestoreError('snapshot-invalid');
  }
  if (typeof text !== 'string') throw new ProjectSnapshotRestoreError('snapshot-unavailable');
  const admission = admitCanonicalProjectDocument(text, importedProjectJsonSchema);
  if (admission.status === 'REFUSED' || admission.canonical === null) {
    throw new ProjectSnapshotRestoreError('snapshot-invalid');
  }
  const admitted = JSON.parse(admission.canonical.raw) as Record<string, unknown>;
  if (projectIdOf(admitted) !== projectIdOf(currentProject)) {
    throw new ProjectSnapshotRestoreError('snapshot-owner-mismatch');
  }
  return { ...admitted, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION };
}
