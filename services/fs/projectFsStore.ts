/**
 * FsProjectStore — Project CRUD + import/export on the filesystem.
 * ENCRYPTION: plaintext — manuscript data; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from fileSystemService.ts. saveProject triggers auto-snapshot via FsSnapshotStore.
 */

import type { EntityState } from '@reduxjs/toolkit';
import { scheduleCoreProjectValidation } from '../../features/project/coreValidationShadow';
import type { Character, StoryProject, World } from '../../types';
import { getStaticTranslation } from '../i18n/staticTranslate';
import { logger } from '../logger';
import { parseImportedProjectJson } from '../projectImportSchema';
import {
  normalizeSaveProjectInputToStoryProject,
  type ProjectQuarantineResult,
  type SaveProjectInput,
} from '../storageBackend';
import { FsAssetStore } from './assetFsStore';
import {
  compressData,
  decompressData,
  retryFs,
  sanitizePathSegment,
  type TauriApis,
  writeTextFileAtomic,
} from './fsCore';

// QNBS-v3 (DA-01): distinguishes corrupt/unreadable saved data from genuine absence — callers must never treat this the same as "no project exists yet".
export class ProjectLoadError extends Error {
  constructor(
    public readonly reason: 'corrupt' | 'io-error',
    message: string,
    public readonly projectId: string,
  ) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

// QNBS-v3: a stable deletion outcome keeps incomplete legacy cleanup retryable without exposing filesystem details.
export class ProjectDeleteError extends Error {
  constructor() {
    super(
      'Project deletion completed for the main project, but legacy auxiliary cleanup is incomplete.',
    );
    this.name = 'ProjectDeleteError';
  }
}

export class ProjectQuarantineError extends Error {
  constructor(
    public readonly reason:
      | 'not-found'
      | 'io-error'
      | 'name-exhausted'
      | 'already-preserved'
      | 'source-missing',
  ) {
    super(
      reason === 'source-missing'
        ? 'The project source is no longer present, but its preservation location could not be confirmed.'
        : 'Project preservation failed. The original project was not deleted.',
    );
    this.name = 'ProjectQuarantineError';
  }
}

// QNBS-v3 (CodeAnt/CodeRabbit): array-or-EntityState — characters/worlds may be either shape in a real saved project.
function isArrayOrEntityState(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)['ids']) &&
    typeof (value as Record<string, unknown>)['entities'] === 'object'
  );
}

// QNBS-v3 (DA-01): rejects parsed JSON that isn't project-shaped at all (e.g. an unrelated file, or a prior empty-object substitution bug) instead of silently hydrating a near-blank project.
function looksLikeStoryProject(value: unknown): value is StoryProject {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['title'] === 'string' &&
    typeof v['logline'] === 'string' &&
    Array.isArray(v['manuscript']) &&
    isArrayOrEntityState(v['characters']) &&
    isArrayOrEntityState(v['worlds'])
  );
}

// QNBS-v3: one sanitizer and empty-ID policy keeps every filesystem project operation on the same path identity.
function projectPathSegment(projectId: string): string | null {
  const safeProjectId = sanitizePathSegment(projectId, '');
  return safeProjectId && safeProjectId !== '.' && safeProjectId !== '..' ? safeProjectId : null;
}

function persistedProjectId(project: StoryProject): unknown {
  return (project as unknown as Record<string, unknown>)['id'];
}

function hasUnusablePersistedProjectId(project: StoryProject): boolean {
  const rawProjectId = persistedProjectId(project);
  return typeof rawProjectId !== 'string' || !projectPathSegment(rawProjectId);
}

function hasLegacyMissingProjectId(project: StoryProject, safeProjectId: string): boolean {
  return (
    typeof persistedProjectId(project) !== 'string' &&
    safeProjectId === (projectPathSegment(project.title) ?? 'project')
  );
}

function isLegacyInvalidProjectId(project: StoryProject): project is StoryProject & { id: string } {
  const rawProjectId = persistedProjectId(project);
  return typeof rawProjectId === 'string' && !projectPathSegment(rawProjectId);
}

function legacyBinderAssetIds(project: StoryProject): string[] {
  return (project.binderNodes ?? [])
    .map((node) => node.binderAssetId)
    .filter((assetId): assetId is string => typeof assetId === 'string')
    .map((assetId) => sanitizePathSegment(assetId, 'asset'));
}

// QNBS-v3: Binder IDs become suffixed filenames, so dot segments remain safe here while project directory dots stay rejected.
function persistedBinderAssetId(assetId: unknown): assetId is string {
  return (
    typeof assetId === 'string' &&
    assetId.length > 0 &&
    sanitizePathSegment(assetId, 'asset') === assetId
  );
}

type LegacyAuxiliaryEvidence = {
  codex: boolean;
  binderAssetIds: Set<string>;
  inspectionComplete: boolean;
};

const LEGACY_AUXILIARY_METADATA_KEY = '__worldscriptLegacyAuxiliary';

type PersistedLegacyAuxiliaryMetadata = {
  legacyProjectId: 'project';
  legacyRawProjectId: string;
  codex: boolean;
  binderAssetIds: string[];
};

function persistedLegacyAuxiliaryMetadata(
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

function persistedMetadataFromEvidence(
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

function evidenceFromPersistedMetadata(
  metadata: PersistedLegacyAuxiliaryMetadata,
): LegacyAuxiliaryEvidence {
  return {
    codex: metadata.codex,
    binderAssetIds: new Set(metadata.binderAssetIds),
    inspectionComplete: true,
  };
}

function migratedProjectIdentity(
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

export class FsProjectStore extends FsAssetStore {
  private async inspectLegacyAuxiliaryEvidence(
    project: StoryProject,
    safeProjectId: string,
    apis: TauriApis,
    appDataPath: string,
  ): Promise<LegacyAuxiliaryEvidence> {
    const evidence: LegacyAuxiliaryEvidence = {
      codex: false,
      binderAssetIds: new Set(),
      inspectionComplete: true,
    };
    const rawProjectId = persistedProjectId(project);
    if (
      !isLegacyInvalidProjectId(project) ||
      safeProjectId === 'project' ||
      typeof rawProjectId !== 'string'
    ) {
      return evidence;
    }

    try {
      const legacyProjectPath = await apis.join(appDataPath, 'projects', 'project');
      const legacyProjectFile = await apis.join(legacyProjectPath, 'project.json');
      if (await apis.exists(legacyProjectFile)) return evidence;

      const codexFile = await apis.join(legacyProjectPath, 'codex', 'codex.snap');
      if (await apis.exists(codexFile)) {
        try {
          const legacyCodex = decompressData<unknown>(await apis.readTextFile(codexFile));
          if (
            typeof legacyCodex === 'object' &&
            legacyCodex !== null &&
            (legacyCodex as Record<string, unknown>)['projectId'] === rawProjectId
          ) {
            evidence.codex = true;
          }
        } catch (error) {
          evidence.inspectionComplete = false;
          logger.warn('Could not verify legacy codex ownership during project load', {
            projectId: safeProjectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const binderPath = await apis.join(legacyProjectPath, 'binder');
      for (const assetId of new Set(legacyBinderAssetIds(project))) {
        const binFile = await apis.join(binderPath, `${assetId}.bin`);
        const metaFile = await apis.join(binderPath, `${assetId}.meta.json`);
        if ((await apis.exists(binFile)) && (await apis.exists(metaFile))) {
          evidence.binderAssetIds.add(assetId);
        }
      }
    } catch (error) {
      evidence.inspectionComplete = false;
      logger.warn('Could not inspect legacy auxiliary project data during load', {
        projectId: safeProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return evidence;
  }

  private async legacyFallbackProjectState(
    safeProjectId: string,
    apis: TauriApis,
    appDataPath: string,
  ): Promise<'confirmed' | 'absent' | 'indeterminate'> {
    if (safeProjectId === 'project') return 'confirmed';
    try {
      const legacyProjectFile = await apis.join(appDataPath, 'projects', 'project', 'project.json');
      return (await apis.exists(legacyProjectFile)) ? 'confirmed' : 'absent';
    } catch (error) {
      logger.warn('Could not validate persisted legacy auxiliary provenance', {
        projectId: safeProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'indeterminate';
    }
  }

  private async migrateLegacyProjectIdentity(
    project: StoryProject,
    safeProjectId: string,
    apis: TauriApis,
    appDataPath: string,
  ): Promise<StoryProject> {
    const persistedMetadata = persistedLegacyAuxiliaryMetadata(project);
    const currentProjectId = persistedProjectId(project);
    const hasLegacyInvalidId =
      typeof currentProjectId === 'string' && !projectPathSegment(currentProjectId);
    if (
      persistedMetadata &&
      currentProjectId !== safeProjectId &&
      currentProjectId !== persistedMetadata.legacyRawProjectId
    ) {
      this.clearLegacyAuxiliaryPolicy(safeProjectId);
    } else if (persistedMetadata) {
      const legacyProjectState = await this.legacyFallbackProjectState(
        safeProjectId,
        apis,
        appDataPath,
      );
      if (legacyProjectState === 'confirmed') {
        this.clearLegacyAuxiliaryPolicy(safeProjectId);
      } else if (legacyProjectState === 'absent') {
        this.registerLegacyAuxiliaryPolicy(
          safeProjectId,
          persistedMetadata.legacyProjectId,
          evidenceFromPersistedMetadata(persistedMetadata),
        );
      } else {
        throw new ProjectLoadError(
          'io-error',
          'Could not validate legacy auxiliary project ownership while loading this project.',
          safeProjectId,
        );
      }
    } else if (!hasLegacyInvalidId) {
      this.clearLegacyAuxiliaryPolicy(safeProjectId);
    }
    if (!hasUnusablePersistedProjectId(project)) {
      return project;
    }

    const rawProjectId = persistedProjectId(project);
    if (typeof rawProjectId !== 'string' && !hasLegacyMissingProjectId(project, safeProjectId)) {
      this.clearLegacyAuxiliaryPolicy(safeProjectId);
      return project;
    }
    if (typeof rawProjectId === 'string' && !projectPathSegment(rawProjectId)) {
      const evidence = await this.inspectLegacyAuxiliaryEvidence(
        project,
        safeProjectId,
        apis,
        appDataPath,
      );
      if (!evidence.inspectionComplete) {
        throw new ProjectLoadError(
          'io-error',
          'Could not verify legacy auxiliary project data while loading this project.',
          safeProjectId,
        );
      }
      this.clearLegacyAuxiliaryPolicy(safeProjectId);
      this.registerLegacyAuxiliaryPolicy(safeProjectId, 'project', evidence);
      return migratedProjectIdentity(project, safeProjectId, rawProjectId, evidence);
    }
    if (hasLegacyInvalidId) {
      return project;
    }
    this.clearLegacyAuxiliaryPolicy(safeProjectId);
    return migratedProjectIdentity(project, safeProjectId);
  }

  private async resolveLegacySaveIdentity(
    project: StoryProject,
    rawProjectId: string,
    apis: TauriApis,
    appDataPath: string,
  ): Promise<{
    projectId: string;
    metadata: PersistedLegacyAuxiliaryMetadata | null;
    inspectionComplete: boolean;
  } | null> {
    if (!rawProjectId.trim()) return null;
    const legacyProjectId = sanitizePathSegment(rawProjectId, 'item');
    if (!legacyProjectId || legacyProjectId === '.' || legacyProjectId === '..') return null;
    const projectFile = await apis.join(appDataPath, 'projects', legacyProjectId, 'project.json');
    if (!(await apis.exists(projectFile))) return null;

    let existingProject: StoryProject;
    try {
      const parsed = decompressData<unknown>(await retryFs(() => apis.readTextFile(projectFile)));
      if (!looksLikeStoryProject(parsed)) return null;
      existingProject = parsed;
    } catch {
      return null;
    }
    const existingMetadata = persistedLegacyAuxiliaryMetadata(existingProject);
    const existingRawProjectId = persistedProjectId(existingProject);
    if (
      existingRawProjectId !== rawProjectId &&
      existingMetadata?.legacyRawProjectId !== rawProjectId
    ) {
      return null;
    }

    const evidence = existingMetadata
      ? evidenceFromPersistedMetadata(existingMetadata)
      : await this.inspectLegacyAuxiliaryEvidence(
          {
            ...existingProject,
            binderNodes: [...(existingProject.binderNodes ?? []), ...(project.binderNodes ?? [])],
          },
          legacyProjectId,
          apis,
          appDataPath,
        );
    return {
      projectId: legacyProjectId,
      metadata: existingMetadata ?? persistedMetadataFromEvidence(rawProjectId, evidence),
      inspectionComplete: existingMetadata ? true : evidence.inspectionComplete,
    };
  }

  async saveProject(project: SaveProjectInput): Promise<void> {
    const flat = normalizeSaveProjectInputToStoryProject(project);
    const rawProjectId = (flat as unknown as Record<string, unknown>)['id'];
    const suppliedProjectId = typeof rawProjectId === 'string';
    let projectId: string;
    let projectToPersist = flat;
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    if (suppliedProjectId) {
      const safeProjectId = projectPathSegment(rawProjectId);
      if (!safeProjectId) {
        const legacyIdentity = await this.resolveLegacySaveIdentity(
          flat,
          rawProjectId,
          apis,
          appDataPath,
        );
        if (!legacyIdentity) {
          throw new Error('Cannot save a project with an unusable project ID.');
        }
        if (!legacyIdentity.inspectionComplete) {
          throw new Error(
            'Cannot safely save this legacy project until its auxiliary data can be verified.',
          );
        }
        projectId = legacyIdentity.projectId;
        projectToPersist = {
          ...flat,
          id: projectId,
          ...(legacyIdentity.metadata
            ? { [LEGACY_AUXILIARY_METADATA_KEY]: legacyIdentity.metadata }
            : {}),
        } as StoryProject;
      } else {
        projectId = safeProjectId;
      }
    } else {
      projectId = projectPathSegment(flat.title || '') ?? 'project';
    }

    // Auto-snapshot: fire-and-forget, mirrors dbService behaviour
    if (Date.now() - this.lastAutoSnapshotTime > this.AUTO_SNAPSHOT_INTERVAL) {
      this.lastAutoSnapshotTime = Date.now();
      this.saveSnapshot('auto', projectToPersist)
        .then(() => this.pruneAutoSnapshots())
        .catch(() => {});
    }

    const projectPath = await apis.join(appDataPath, 'projects', projectId);

    if (!(await apis.exists(projectPath))) {
      await apis.mkdir(projectPath, { recursive: true });
    }

    const projectFile = await apis.join(projectPath, 'project.json');
    await writeTextFileAtomic(apis, projectFile, compressData(projectToPersist));
    // QNBS-v3 (#332): documented best-effort abort — the project data above already saved; a failed marker write only degrades the next cold-boot's project selection, not worth failing this save over.
    await this.setActiveProjectId(projectId).catch((error) => {
      logger.warn('Failed to persist active-project marker (project save itself succeeded)', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** QNBS-v3 (#332): marker file recording the last-saved project ID, read back at cold boot. */
  private async setActiveProjectId(projectId: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');
    if (!(await apis.exists(configPath))) {
      await apis.mkdir(configPath, { recursive: true });
    }
    const markerFile = await apis.join(configPath, 'active-project-id.txt');
    await writeTextFileAtomic(apis, markerFile, projectId);
  }

  /**
   * The last-saved project's ID, or null if no marker exists yet (fresh install, or one that
   * predates this marker — callers should fall back to a deterministic choice among
   * `listProjects()`'s results, not assume null means no projects exist).
   */
  async getActiveProjectId(): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const markerFile = await apis.join(appDataPath, 'config', 'active-project-id.txt');
      if (!(await apis.exists(markerFile))) return null;
      const id = (await retryFs(() => apis.readTextFile(markerFile))).trim();
      return id || null;
    } catch (error) {
      logger.error('Failed to read active project marker:', error);
      return null;
    }
  }

  /**
   * Genuine absence (no saved file for this ID) resolves to `null` — legitimate and unchanged.
   * A corrupt or unreadable file throws `ProjectLoadError` instead: DA-01 requires that this never
   * collapse into the same `null` a caller would read as "no project exists yet".
   */
  async loadProject(projectId: string): Promise<StoryProject | null> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeProjectId = projectPathSegment(projectId);
    if (!safeProjectId) return null;
    const projectFile = await apis.join(appDataPath, 'projects', safeProjectId, 'project.json');

    // QNBS-v3 (CodeRabbit/codex): exists() rejecting is an I/O failure too, not absence — classify it the same as a readTextFile failure rather than letting it escape raw.
    let content: string;
    try {
      if (!(await apis.exists(projectFile))) {
        this.clearLegacyAuxiliaryPolicy(safeProjectId);
        return null;
      }
      content = await retryFs(() => apis.readTextFile(projectFile));
    } catch (error) {
      logger.error('Failed to read project file (I/O error):', error);
      throw new ProjectLoadError(
        'io-error',
        `Could not read the project file for "${projectId}" — it may be locked, permission-denied, or otherwise inaccessible.`,
        projectId,
      );
    }

    let project: StoryProject;
    try {
      const parsed = decompressData<unknown>(content);
      if (!looksLikeStoryProject(parsed)) {
        throw new Error('Parsed content is not project-shaped (missing title/manuscript).');
      }
      project = parsed;
    } catch (error) {
      logger.error('Failed to parse project file (corrupt data):', error);
      throw new ProjectLoadError(
        'corrupt',
        `The saved project file for "${projectId}" appears to be corrupted and could not be read. The file has not been deleted.`,
        projectId,
      );
    }

    // QNBS-v3: schedule observation after this async load resolves so validation cannot delay or alter the load result.
    const migratedProject = await this.migrateLegacyProjectIdentity(
      project,
      safeProjectId,
      apis,
      appDataPath,
    );
    scheduleCoreProjectValidation(migratedProject);
    return migratedProject;
  }

  async listProjects(): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const projectsPath = await apis.join(appDataPath, 'projects');

      if (!(await apis.exists(projectsPath))) {
        return [];
      }

      const entries = await retryFs(() => apis.readDir(projectsPath));
      return entries.filter((entry) => entry.name).map((entry) => entry.name as string);
    } catch (error) {
      logger.error('Failed to list projects:', error);
      return [];
    }
  }

  // QNBS-v3: move the whole folder before reload so corrupt project artifacts remain recoverable.
  /** Move the whole corrupt project directory aside so its manuscript and assets remain recoverable. */
  async quarantineProject(projectId: string): Promise<ProjectQuarantineResult> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeProjectId = projectPathSegment(projectId);
      if (!safeProjectId) throw new ProjectQuarantineError('not-found');
      const projectPath = await apis.join(appDataPath, 'projects', safeProjectId);
      if (!(await apis.exists(projectPath))) {
        throw new ProjectQuarantineError('not-found');
      }

      const quarantineRoot = await apis.join(appDataPath, 'quarantined-projects');
      await apis.mkdir(quarantineRoot, { recursive: true });
      const timestamp = Date.now();
      for (let attempt = 0; attempt < 100; attempt++) {
        const suffix = attempt === 0 ? String(timestamp) : `${timestamp}-${attempt}`;
        const quarantinePath = await apis.join(
          quarantineRoot,
          `${safeProjectId}-corrupt-${suffix}`,
        );
        // QNBS-v3: reserve a unique directory atomically so rename cannot replace a concurrent quarantine target.
        try {
          await apis.mkdir(quarantinePath);
        } catch (error) {
          let targetExists: boolean;
          try {
            targetExists = await apis.exists(quarantinePath);
          } catch (probeError) {
            logger.error('Failed to inspect a concurrent quarantine result', {
              projectId,
              error: probeError instanceof Error ? probeError.message : String(probeError),
            });
            throw new ProjectQuarantineError('io-error');
          }
          if (targetExists) continue;
          logger.error('Failed to reserve quarantine directory', {
            projectId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new ProjectQuarantineError('io-error');
        }

        const preservedPath = await apis.join(quarantinePath, safeProjectId);
        const releaseReservation = async (): Promise<void> => {
          try {
            await apis.remove(quarantinePath, { recursive: true });
          } catch (cleanupError) {
            logger.warn('Failed to remove reserved quarantine directory after a failed move', {
              projectId,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          }
        };
        try {
          await retryFs(() => apis.rename(projectPath, preservedPath));
          return { projectId, path: preservedPath };
        } catch (error) {
          let sourceExists: boolean;
          let preservedExists: boolean;
          try {
            sourceExists = await apis.exists(projectPath);
            preservedExists = await apis.exists(preservedPath);
          } catch (probeError) {
            logger.error('Failed to inspect a concurrent quarantine result', {
              projectId,
              error: probeError instanceof Error ? probeError.message : String(probeError),
            });
            throw new ProjectQuarantineError('io-error');
          }
          if (!sourceExists && preservedExists) return { projectId, path: preservedPath };
          if (!sourceExists) {
            await releaseReservation();
            throw new ProjectQuarantineError('source-missing');
          }
          await releaseReservation();
          logger.error('Failed to quarantine project directory', {
            projectId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new ProjectQuarantineError('io-error');
        }
      }

      throw new ProjectQuarantineError('name-exhausted');
    } catch (error) {
      if (error instanceof ProjectQuarantineError) throw error;
      logger.error('Failed to prepare project quarantine', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectQuarantineError('io-error');
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeProjectId = projectPathSegment(projectId);
    if (!safeProjectId) return;
    const projectPath = await apis.join(appDataPath, 'projects', safeProjectId);

    if (await apis.exists(projectPath)) {
      await retryFs(() => apis.remove(projectPath, { recursive: true }));
    }

    try {
      const legacyBinderIds = this.legacyBinderAssetIdsForProject(safeProjectId);
      if (legacyBinderIds.length > 0) {
        for (const assetId of legacyBinderIds) {
          await this.deleteBinderAssetStrict(safeProjectId, assetId);
        }
      }
      if (this.legacyCodexProjectId(safeProjectId)) {
        await this.deleteStoryCodexStrict(safeProjectId);
      }
    } catch (error) {
      logger.error('Failed to clean up legacy project data during deletion', {
        projectId: safeProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectDeleteError();
    }
    this.clearLegacyAuxiliaryPolicy(safeProjectId);
  }

  // Import/Export functionality

  async exportProject(
    project: StoryProject,
    format: 'json' | 'markdown' | 'docx' = 'json',
  ): Promise<void> {
    const apis = await this.getApis();
    const fileName = project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // QNBS-v3 (DA-05): real DOCX via apis.writeFile (binary) — Packer.toBuffer needs Node's Buffer, unavailable in the Tauri WebView, so use the browser-safe toArrayBuffer path instead.
    if (format === 'docx') {
      const { Packer } = await import('docx');
      const { buildDocxDocument } = await import('../export/docxDocumentBuilder');
      const [loglineLabel, manuscriptHeading] = await Promise.all([
        getStaticTranslation('export.loglineLabel'),
        getStaticTranslation('export.manuscriptLabel'),
      ]);
      const doc = buildDocxDocument({
        title: project.title,
        loglineLabel,
        logline: project.logline,
        manuscript: { heading: manuscriptHeading, sections: project.manuscript },
      });
      const arrayBuffer = await Packer.toArrayBuffer(doc);
      const filePath = await apis.save({
        defaultPath: `${fileName}.docx`,
        filters: [{ name: 'DOCX', extensions: ['docx'] }],
      });
      if (filePath) {
        await retryFs(() => apis.writeFile(filePath, new Uint8Array(arrayBuffer)));
      }
      return;
    }

    let content: string;
    let extension: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(project, null, 2);
        extension = 'json';
        break;
      case 'markdown':
        content = this.convertToMarkdown(project);
        extension = 'md';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const filePath = await apis.save({
      defaultPath: `${fileName}.${extension}`,
      filters: [{ name: format.toUpperCase(), extensions: [extension] }],
    });

    if (filePath) {
      await retryFs(() => apis.writeTextFile(filePath, content));
    }
  }

  async importProject(): Promise<StoryProject | null> {
    const apis = await this.getApis();
    const filePath = await apis.open({
      multiple: false,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!filePath || Array.isArray(filePath)) {
      return null;
    }

    const content = await retryFs(() => apis.readTextFile(filePath));

    if (filePath.endsWith('.json')) {
      const parsed = parseImportedProjectJson(content);
      type CharRow = Character & { avatarBase64?: string };
      type WorldRow = World & { ambianceImageBase64?: string };
      let characterArray: CharRow[] = [];
      if (Array.isArray(parsed.characters)) {
        characterArray = parsed.characters as CharRow[];
      } else if (parsed.characters && 'ids' in parsed.characters) {
        const { ids, entities } = parsed.characters;
        characterArray = ids
          .map((id: string) => entities[id])
          .filter((item): item is CharRow => Boolean(item));
      }
      const charactersOut: Character[] = [];
      for (const char of characterArray) {
        const row = { ...char };
        if (row.avatarBase64) {
          await this.saveImage(row.id, row.avatarBase64);
          row.hasAvatar = true;
          delete row.avatarBase64;
        }
        charactersOut.push(row);
      }

      let worldArray: WorldRow[] = [];
      if (Array.isArray(parsed.worlds)) {
        worldArray = parsed.worlds as WorldRow[];
      } else if (parsed.worlds && 'ids' in parsed.worlds) {
        const { ids, entities } = parsed.worlds;
        worldArray = ids
          .map((id: string) => entities[id])
          .filter((item): item is WorldRow => Boolean(item));
      }
      const worldsOut: World[] = [];
      for (const world of worldArray) {
        const row = { ...world };
        if (row.ambianceImageBase64) {
          await this.saveImage(row.id, row.ambianceImageBase64);
          row.hasAmbianceImage = true;
          delete row.ambianceImageBase64;
        }
        worldsOut.push(row);
      }

      return {
        title: parsed.title,
        logline: parsed.logline,
        characters: charactersOut,
        worlds: worldsOut,
        outline: parsed.outline,
        manuscript: parsed.manuscript ?? [],
        binderNodes: parsed.binderNodes,
        projectGoals: parsed.projectGoals,
        writingHistory: parsed.writingHistory,
        // QNBS-v3: Parse-Ergebnis angleichen — Zod optional vs. StoryProject exactOptionalPropertyTypes.
      } as StoryProject;
    } else if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
      return this.parseMarkdownProject(content);
    }

    throw new Error('Unsupported file format');
  }

  private convertToMarkdown(project: StoryProject): string {
    const characters = Array.isArray(project.characters)
      ? project.characters
      : (Object.values((project.characters as EntityState<Character, string>).entities).filter(
          Boolean,
        ) as Character[]);
    const worlds = Array.isArray(project.worlds)
      ? project.worlds
      : (Object.values((project.worlds as EntityState<World, string>).entities).filter(
          Boolean,
        ) as World[]);
    const markdown = `---
title: "${project.title}"
---

# ${project.title}

## Characters

${characters
  .map(
    (char: Character) => `### ${char.name}

${char.backstory || ''}

**Personality:** ${char.personalityTraits || ''}
**Motivation:** ${char.motivation || ''}
**Appearance:** ${char.appearance || ''}

`,
  )
  .join('\n')}

## Worlds

${worlds
  .map(
    (world: World) => `### ${world.name}

${world.description || ''}

**Geography:** ${world.geography || ''}
**Culture:** ${world.culture || ''}

`,
  )
  .join('\n')}

## Manuscript

${project.manuscript || 'No manuscript content yet.'}

`;

    return markdown;
  }

  private parseMarkdownProject(content: string): StoryProject {
    const lines = content.split('\n');
    let title = 'Imported Project';
    let description = '';
    let author = '';
    let manuscript = '';

    let inFrontmatter = false;
    let inManuscript = false;

    for (const line of lines) {
      if (line.trim() === '---') {
        inFrontmatter = !inFrontmatter;
        continue;
      }

      if (inFrontmatter) {
        if (line.startsWith('title:')) {
          title = line.split(':')[1]?.trim().replace(/"/g, '') ?? title;
        } else if (line.startsWith('author:')) {
          author = line.split(':')[1]?.trim().replace(/"/g, '') ?? author;
        } else if (line.startsWith('description:')) {
          description = line.split(':')[1]?.trim().replace(/"/g, '') ?? description;
        }
      } else if (line.startsWith('## Manuscript')) {
        inManuscript = true;
      } else if (inManuscript && line.startsWith('## ')) {
        inManuscript = false;
      } else if (inManuscript) {
        manuscript += `${line}\n`;
      }
    }

    const logline = description || (author ? `Imported by ${author}` : 'Imported project');
    const manuscriptSections = manuscript
      ? [{ id: 'imported-manuscript-1', title: 'Imported Manuscript', content: manuscript.trim() }]
      : [
          {
            id: 'imported-manuscript-1',
            title: 'Imported Manuscript',
            content: 'No manuscript content yet.',
          },
        ];

    return {
      title,
      logline,
      characters: [],
      worlds: [],
      manuscript: manuscriptSections,
    } as StoryProject;
  }
}
