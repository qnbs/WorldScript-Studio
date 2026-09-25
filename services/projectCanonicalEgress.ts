/**
 * Canonical project egress (#553, PROJECT-CORE-COMPATIBILITY-CONTRACT §2.8).
 *
 * Export and backup must serialize the canonical raw payload, not the typed projection: the
 * projection silently drops opaque/out-of-scope fields and rounds unsafe integers, so a file
 * written from it loses data that the stored project still holds.
 */

import type { ProjectData } from '../features/project/projectSlice';
import type { StoryProject } from '../types';
import { buildAutosaveOwnedProjectEdit } from './projectAutosaveEditBridge';
import {
  type CanonicalProjectRawText,
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
} from './projectDocumentWriteback';
import { storageService } from './storageService';

export class ProjectEgressError extends Error {
  constructor(public readonly detail: string) {
    super('The project could not be exported without losing stored data. Nothing was written.');
    this.name = 'ProjectEgressError';
  }
}

// QNBS-v3 (#553 §2.8): the same owned-edit overlay a save would commit, computed without committing, so unsaved edits are included and every field the editor does not own survives byte-for-byte.
export function overlayProjectOntoCanonicalRaw(
  project: ProjectData | StoryProject,
  storedRaw: CanonicalProjectRawText | null,
): CanonicalProjectRawText {
  if (storedRaw === null) return JSON.stringify(project);
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

// QNBS-v3 (#553 §2.8): nothing stored yet means there is nothing opaque to lose, so the in-memory project is the whole truth.
export async function loadCanonicalEgressRaw(
  projectId: string | undefined,
  project: ProjectData | StoryProject,
): Promise<CanonicalProjectRawText> {
  // QNBS-v3 (#553 §2.8): the same key IndexedDB's listProjects reports for an id-less project.
  const storageKey = projectId || 'browser-project';
  return overlayProjectOntoCanonicalRaw(
    project,
    await storageService.loadCanonicalProjectRaw(storageKey),
  );
}
