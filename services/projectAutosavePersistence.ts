import type { ProjectData } from '../features/project/projectSlice';
import {
  assertCanonicalAutosaveSucceeded,
  saveAutosaveSnapshotCanonical,
} from './projectAutosaveCanonicalWriter';
import { saveEnvelopeFromProjectData } from './storageBackend';
import { storageService } from './storageService';
import { isTauriRuntime } from './tauriRuntime';

/**
 * Persists one autosave snapshot through the authority appropriate to the running product.
 *
 * The canonical writer is an IndexedDB authority and therefore owns the web/PWA path only.
 * Tauri retains its existing filesystem backend until that backend has an equivalent admitted
 * generation-fenced writer.
 */
export async function persistProjectAutosaveSnapshot(snapshot: ProjectData): Promise<void> {
  if (isTauriRuntime()) {
    await storageService.saveProject(saveEnvelopeFromProjectData(snapshot));
    return;
  }

  const result = await saveAutosaveSnapshotCanonical(snapshot);
  assertCanonicalAutosaveSucceeded(result);
}
