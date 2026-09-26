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
import { isReplacementPending, replacementCarrierFor } from './editorProjectGeneration';
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

// QNBS-v3 (#553 a11): snapshots are historical, so a supported older one stays exportable as it was stored (restore migrates it on admission); only local metadata is removed, and a snapshot this build could never admit is refused.
export function toPortableSnapshotRaw(raw: string): string {
  const portable = stripTopLevelObjectKeys(raw, PORTABLE_LOCAL_METADATA_KEYS);
  if (portable === null) throw new ProjectEgressError('local metadata could not be removed');
  const verdict = admitCanonicalProjectDocument(portable, importedProjectJsonSchema);
  if (verdict.status === 'REFUSED') {
    throw new ProjectEgressError(`portable snapshot is ${verdict.source.classification}`);
  }
  return portable;
}

// QNBS-v3 (#553 §2.8): the same owned-edit overlay a save would commit, computed without committing — unsaved edits are included and every field the editor does not own keeps its stored text. Nothing stored yet gets the same versioned first document a first save would write.
export function overlayProjectOntoCanonicalRaw(
  project: ProjectData | StoryProject,
  storedRaw: CanonicalProjectRawText | null,
): CanonicalProjectRawText {
  return toPortableProjectRaw(overlayOwnedEditOntoCanonicalRaw(project, storedRaw));
}

function overlayOwnedEditOntoCanonicalRaw(
  project: ProjectData | StoryProject,
  storedRaw: CanonicalProjectRawText | null,
): CanonicalProjectRawText {
  if (storedRaw === null) return buildInitialCanonicalRaw(project);
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
  return result.raw;
}

// QNBS-v3 (#553 §2.8): the backend resolves which stored project the editor is working on (a filesystem project's identity can be its directory, not its id) and is always asked, so a stale, refused or unsupported source fails closed; a replaced editor project then discards the stored text as content and is exported from its own state alone.
export async function loadCanonicalEgressRaw(
  projectId: string | undefined,
  project: ProjectData | StoryProject,
): Promise<CanonicalProjectRawText> {
  return toPortableProjectRaw(await loadEditorCanonicalRaw(projectId, project));
}

async function loadEditorCanonicalRaw(
  projectId: string | undefined,
  project: ProjectData | StoryProject,
): Promise<CanonicalProjectRawText> {
  const storedRaw = await storageService.loadEditorExportCarrier(projectId);
  const replaced = isReplacementPending(project, await storageService.getProjectAuthority());
  // QNBS-v3 (#553 a5): a restored editor project exports the snapshot text it was restored from, not the replaced stored project and not a fresh re-serialization.
  const base = replaced ? replacementCarrierFor(project) : storedRaw;
  return overlayOwnedEditOntoCanonicalRaw(project, base);
}

// QNBS-v3 (#553 §2.8): a manual snapshot is the same canonical text export uses (same fence, same replacement rule) but stays local, so machine-local metadata is kept for the restore path that re-derives it.
export async function createCanonicalProjectSnapshot(
  name: string,
  projectId: string | undefined,
  project: ProjectData | StoryProject,
): Promise<number> {
  return storageService.saveSnapshotText(name, await loadEditorCanonicalRaw(projectId, project));
}

// QNBS-v3 (#553 §2.8): shared by every "Export JSON" surface (settings, dashboard, advanced import/export); a refusal writes no file, is reported through onRefused and resolves false, so a caller never reports a download that did not happen.
export async function downloadCanonicalProjectExport(
  projectId: string | undefined,
  project: ProjectData | StoryProject,
  onRefused: (error: unknown) => void,
): Promise<boolean> {
  let raw: CanonicalProjectRawText;
  try {
    raw = await loadCanonicalEgressRaw(projectId, project);
  } catch (error) {
    onRefused(error);
    return false;
  }
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.download = `${project.title.replace(/\s+/g, '_')}_backup.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
