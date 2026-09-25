/**
 * Canonical project egress (#553, PROJECT-CORE-COMPATIBILITY-CONTRACT §2.8, §3.1, §4).
 *
 * Export and backup serialize the stored canonical raw payload rather than re-serializing a parsed
 * project object. Re-serializing a parse cannot reproduce the persisted text exactly — the
 * filesystem carrier can hold integers beyond Number.MAX_SAFE_INTEGER that a parse rounds — and
 * the portable result must also drop machine-local trust metadata (§2.8), which the stored text
 * legitimately carries.
 */

import type { ProjectData } from '../features/project/projectSlice';
import type { StoryProject } from '../types';
import { buildInitialCanonicalRaw } from './projectAutosaveCanonicalWriter';
import { buildAutosaveOwnedProjectEdit } from './projectAutosaveEditBridge';
import { admitCanonicalProjectDocument, stripTopLevelObjectKeys } from './projectDocument';
import {
  type CanonicalProjectRawText,
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
} from './projectDocumentWriteback';
import { importedProjectJsonSchema, PORTABLE_LOCAL_METADATA_KEYS } from './projectImportSchema';
import { storageService } from './storageService';

export class ProjectEgressError extends Error {
  constructor(public readonly detail: string) {
    super('The project could not be exported without losing stored data. Nothing was written.');
    this.name = 'ProjectEgressError';
  }
}

// QNBS-v3 (#553 §2.8): filesystem-local routing/trust metadata is never portable (the key set import strips), and the result is re-admitted as an import would be, so egress never emits a file this app would refuse.
export function toPortableProjectRaw(raw: CanonicalProjectRawText): CanonicalProjectRawText {
  const portable = stripTopLevelObjectKeys(raw, PORTABLE_LOCAL_METADATA_KEYS);
  if (portable === null) throw new ProjectEgressError('local metadata could not be removed');
  const verdict = admitCanonicalProjectDocument(portable, importedProjectJsonSchema);
  if (verdict.status !== 'CURRENT' || verdict.canonical === null) {
    throw new ProjectEgressError(`portable document is ${verdict.source.classification}`);
  }
  return portable;
}

// QNBS-v3 (#553 §2.8): the same owned-edit overlay a save would commit, computed without committing — unsaved edits are included and every field the editor does not own keeps its stored text. Nothing stored yet gets the same versioned first document a first save would write.
export function overlayProjectOntoCanonicalRaw(
  project: ProjectData | StoryProject,
  storedRaw: CanonicalProjectRawText | null,
): CanonicalProjectRawText {
  if (storedRaw === null) return toPortableProjectRaw(buildInitialCanonicalRaw(project));
  let result: ReturnType<typeof commitOwnedProjectEdit>;
  try {
    result = commitOwnedProjectEdit({
      expectedGeneration: computeProjectSourceGeneration(storedRaw),
      currentRaw: storedRaw,
      edit: buildAutosaveOwnedProjectEdit(project, storedRaw),
    });
  } catch (error) {
    throw new ProjectEgressError(error instanceof Error ? error.message : String(error));
  }
  if (result.status !== 'COMMITTED') {
    throw new ProjectEgressError(
      result.status === 'CONFLICT' ? 'source generation changed' : result.status,
    );
  }
  return toPortableProjectRaw(result.raw);
}

let editableProjectReplaced = false;

// QNBS-v3 (#553 §2.8): ProjectSliceState.generation changes only when the editable project is replaced wholesale (reset, import, restore, or an undo across one), often keeping its id — from then on the stored text may still be the replaced project's, so export must not overlay onto it.
export function noteEditableProjectGenerationChanged(): void {
  editableProjectReplaced = true;
}

export function _resetEditableProjectReplacementForTest(): void {
  editableProjectReplaced = false;
}

export function _editableProjectReplacedForTest(): boolean {
  return editableProjectReplaced;
}

// QNBS-v3 (#553 §2.8): the backend resolves which stored project the editor is working on (a filesystem project's identity can be its directory, not its id) and refuses a stale editor; this layer never guesses a storage key. A replaced editor project is exported from its own state alone — everything it legitimately holds is in that state.
export async function loadCanonicalEgressRaw(
  projectId: string | undefined,
  project: ProjectData | StoryProject,
): Promise<CanonicalProjectRawText> {
  if (editableProjectReplaced) return overlayProjectOntoCanonicalRaw(project, null);
  return overlayProjectOntoCanonicalRaw(
    project,
    await storageService.loadEditorExportCarrier(projectId),
  );
}

// QNBS-v3 (#553 §2.8): shared by both "Export JSON" buttons; a refusal writes no file and is reported through onRefused.
export async function downloadCanonicalProjectExport(
  projectId: string | undefined,
  project: StoryProject,
  onRefused: (error: unknown) => void,
): Promise<void> {
  let raw: CanonicalProjectRawText;
  try {
    raw = await loadCanonicalEgressRaw(projectId, project);
  } catch (error) {
    onRefused(error);
    return;
  }
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.download = `${project.title.replace(/\s+/g, '_')}_backup.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
