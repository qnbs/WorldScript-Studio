import type { ProjectData } from '../features/project/projectSlice';
import {
  currentProjectAuthority,
  type EditorReplacementEpoch,
  isReplacementPending,
  notePersistedEditorEpoch,
  toEditorReplacementEpoch,
} from './editorProjectGeneration';
import {
  assertCanonicalAutosaveSucceeded,
  saveAutosaveSnapshotCanonical,
} from './projectAutosaveCanonicalWriter';
import { assertProjectPersistenceAdmitted } from './startupSafeSession';
import { saveEnvelopeFromProjectData } from './storageBackend';
import { storageService } from './storageService';

/**
 * Persists one autosave snapshot through the authority appropriate to the running product.
 *
 * The canonical writer is an IndexedDB authority and therefore owns the web/PWA path only.
 * Tauri retains its existing filesystem backend until that backend has an equivalent admitted
 * generation-fenced writer.
 *
 * This is the single choke point shared by debounced autosave, lifecycle flushes, and manual save,
 * so the safe-session fence (a refused startup project must never gain write authority) lives here.
 */
// QNBS-v3 (#553 a10): a snapshot whose editor epoch storage has not yet committed for this project and authority replaces the stored project instead of being merged into the predecessor's text; only a committed save advances that baseline, so a failed one is retried as a replacement.
export async function persistProjectAutosaveSnapshot(
  snapshot: ProjectData,
  editorEpoch: EditorReplacementEpoch = toEditorReplacementEpoch(0),
): Promise<void> {
  assertProjectPersistenceAdmitted(snapshot.id);
  const authority = currentProjectAuthority();
  const replacement = isReplacementPending(snapshot, authority, editorEpoch);
  if (authority === 'fs') {
    await storageService.saveProject(saveEnvelopeFromProjectData(snapshot), { replacement });
  } else {
    const result = await saveAutosaveSnapshotCanonical(snapshot, undefined, { replacement });
    assertCanonicalAutosaveSucceeded(result);
  }
  notePersistedEditorEpoch(snapshot, authority, editorEpoch);
}
