import type { StoryProject } from '../../types';
import type { SnapshotRestoreTarget } from '../storageBackend';
import { sanitizePathSegment } from './fsCore';

// QNBS-v3: pure identity and metadata codecs stay separate so recovery orchestration remains auditable.
// QNBS-v3: one sanitizer and empty-ID policy keeps every filesystem project operation on the same path identity.
export function projectPathSegment(projectId: string): string | null {
  const safeProjectId = sanitizePathSegment(projectId, '');
  return safeProjectId && safeProjectId !== '.' && safeProjectId !== '..' ? safeProjectId : null;
}

export function persistedProjectId(project: StoryProject): unknown {
  return (project as unknown as Record<string, unknown>)['id'];
}

export const LEGACY_PROJECT_DIRECTORY_METADATA_KEY = '__worldscriptLegacyProjectDirectory';
export const LEGACY_AUXILIARY_METADATA_KEY = '__worldscriptLegacyAuxiliary';

// QNBS-v3: legacy snapshot restoration requires content evidence so an invalid ID cannot claim another project's directory.
export function legacyProjectContent(project: StoryProject): string {
  const value = { ...(project as unknown as Record<string, unknown>) };
  delete value['id'];
  delete value[LEGACY_AUXILIARY_METADATA_KEY];
  delete value[LEGACY_PROJECT_DIRECTORY_METADATA_KEY];
  return JSON.stringify(value) ?? '';
}

export function legacyProjectDirectory(project: StoryProject): string | null {
  const value = (project as unknown as Record<string, unknown>)[
    LEGACY_PROJECT_DIRECTORY_METADATA_KEY
  ];
  return typeof value === 'string' && projectPathSegment(value) === value ? value : null;
}

export function snapshotRestoreTargetDirectory(project: SnapshotRestoreTarget): string | null {
  const rawProjectId = (project as unknown as Record<string, unknown>)['id'];
  if (rawProjectId !== undefined) {
    return typeof rawProjectId === 'string' ? projectPathSegment(rawProjectId) : null;
  }
  return legacyProjectDirectory(project as StoryProject);
}

export function hasLegacyMissingProjectId(project: StoryProject, safeProjectId: string): boolean {
  return (
    typeof persistedProjectId(project) !== 'string' &&
    safeProjectId === (projectPathSegment(project.title) ?? 'project')
  );
}

export function isLegacyInvalidProjectId(
  project: StoryProject,
): project is StoryProject & { id: string } {
  const rawProjectId = persistedProjectId(project);
  return typeof rawProjectId === 'string' && !projectPathSegment(rawProjectId);
}

export function legacyBinderAssetIds(project: StoryProject): string[] {
  return (project.binderNodes ?? [])
    .map((node) => node.binderAssetId)
    .filter((assetId): assetId is string => typeof assetId === 'string')
    .map((assetId) => sanitizePathSegment(assetId, 'asset'));
}

// QNBS-v3: Binder IDs become suffixed filenames, so dot segments remain safe here while project directory dots stay rejected.
export function persistedBinderAssetId(assetId: unknown): assetId is string {
  return (
    typeof assetId === 'string' &&
    assetId.length > 0 &&
    sanitizePathSegment(assetId, 'asset') === assetId
  );
}

export type LegacyAuxiliaryEvidence = {
  codex: boolean;
  binderAssetIds: Set<string>;
  inspectionComplete: boolean;
};

export type PersistedLegacyAuxiliaryMetadata = {
  legacyProjectId: 'project';
  legacyRawProjectId: string;
  codex: boolean;
  binderAssetIds: string[];
};

export type QuarantineLegacyAuxiliaryManifest = {
  projectId: string;
  legacyProjectId: string;
  codex: boolean;
  binderAssetIds: string[];
};

export function persistedLegacyAuxiliaryMetadata(
  project: StoryProject,
): PersistedLegacyAuxiliaryMetadata | null {
  const value = (project as unknown as Record<string, unknown>)[LEGACY_AUXILIARY_METADATA_KEY];
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const rawProjectId = candidate['legacyRawProjectId'];
  const binderAssetIds = candidate['binderAssetIds'];
  if (
    candidate['legacyProjectId'] !== 'project' ||
    typeof rawProjectId !== 'string' ||
    !rawProjectId ||
    projectPathSegment(rawProjectId) ||
    typeof candidate['codex'] !== 'boolean' ||
    !Array.isArray(binderAssetIds) ||
    binderAssetIds.some((assetId) => !persistedBinderAssetId(assetId)) ||
    (!candidate['codex'] && binderAssetIds.length === 0)
  ) {
    return null;
  }
  return {
    legacyProjectId: 'project',
    legacyRawProjectId: rawProjectId,
    codex: candidate['codex'],
    binderAssetIds: [...binderAssetIds] as string[],
  };
}

export function persistedMetadataFromEvidence(
  rawProjectId: string,
  evidence: LegacyAuxiliaryEvidence,
): PersistedLegacyAuxiliaryMetadata | null {
  if (!evidence.inspectionComplete || (!evidence.codex && evidence.binderAssetIds.size === 0)) {
    return null;
  }
  return {
    legacyProjectId: 'project',
    legacyRawProjectId: rawProjectId,
    codex: evidence.codex,
    binderAssetIds: [...evidence.binderAssetIds],
  };
}

export function evidenceFromPersistedMetadata(
  metadata: PersistedLegacyAuxiliaryMetadata,
): LegacyAuxiliaryEvidence {
  return {
    codex: metadata.codex,
    binderAssetIds: new Set(metadata.binderAssetIds),
    inspectionComplete: true,
  };
}

export function migratedProjectIdentity(
  project: StoryProject,
  safeProjectId: string,
  rawProjectId?: string,
  evidence?: LegacyAuxiliaryEvidence,
): StoryProject {
  const metadata =
    rawProjectId && evidence ? persistedMetadataFromEvidence(rawProjectId, evidence) : null;
  // QNBS-v3: legacy fallback directories carry verified auxiliary provenance across restart, while new invalid IDs remain rejected.
  return {
    ...project,
    id: safeProjectId,
    ...(metadata ? { [LEGACY_AUXILIARY_METADATA_KEY]: metadata } : {}),
  } as StoryProject;
}

// QNBS-v3: missing-ID legacy projects retain their loaded directory while callers keep historical auxiliary fallbacks.
export function legacyProjectWithDirectory(
  project: StoryProject,
  safeProjectId: string,
): StoryProject {
  if (legacyProjectDirectory(project) === safeProjectId) return project;
  return {
    ...project,
    [LEGACY_PROJECT_DIRECTORY_METADATA_KEY]: safeProjectId,
  } as StoryProject;
}
