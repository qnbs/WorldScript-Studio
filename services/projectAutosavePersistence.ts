import type { ProjectData } from '../features/project/projectSlice';
import {
  type EditorReplacementEpoch,
  isReplacementPending,
  notePersistedEditorEpoch,
  restoreCarrierFor,
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
 * Persists one autosave snapshot through the authority that actually holds the project.
 *
 * IndexedDB storage (the web/PWA build, and a desktop build whose filesystem init fell back to it)
 * goes through the canonical generation-fenced writer; the desktop filesystem backend keeps its own
 * locked, fenced writer.
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
  const authority = await storageService.getProjectAuthority();
  const replacement = isReplacementPending(snapshot, authority, editorEpoch);
  const replacementRaw = (replacement && restoreCarrierFor(snapshot, editorEpoch)) || undefined;
  const options = replacementRaw === undefined ? { replacement } : { replacement, replacementRaw };
  // QNBS-v3 (#553 a5): the writer follows the storage that really holds the project — a desktop build on its IndexedDB fallback uses the generation-fenced canonical writer, never the legacy whole-record save that ignores the replacement carrier.
  if (authority === 'fs') {
    await storageService.saveProject(saveEnvelopeFromProjectData(snapshot), options);
  } else {
    const result = await saveAutosaveSnapshotCanonical(snapshot, undefined, options);
    assertCanonicalAutosaveSucceeded(result);
  }
  notePersistedEditorEpoch(snapshot, authority, editorEpoch);
}
