/**
 * FsProjectStore — Project CRUD + import/export on the filesystem.
 * ENCRYPTION: plaintext — manuscript data; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from fileSystemService.ts. saveProject triggers auto-snapshot via FsSnapshotStore.
 */

import type { EntityState } from '@reduxjs/toolkit';
import { scheduleCoreProjectValidation } from '../../features/project/coreValidationShadow';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ProjectVersionClassification,
} from '../../features/project/projectSchemaVersion';
import type { Character, StoryProject, World } from '../../types';
import { getStaticTranslation } from '../i18n/staticTranslate';
import { logger } from '../logger';
import { buildAutosaveOwnedProjectEdit } from '../projectAutosaveEditBridge';
import {
  admitCanonicalProjectDocument,
  type CanonicalProjectSchemaResult,
} from '../projectDocument';
import {
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
  type ProjectSourceGeneration,
  type ProjectWritebackResult,
} from '../projectDocumentWriteback';
import { importedProjectJsonSchema, parseImportedProjectJson } from '../projectImportSchema';
import {
  type CanonicalProjectRawResult,
  normalizeSaveProjectInputToStoryProject,
  type ProjectQuarantineResult,
  type RestoredSnapshot,
  type SaveProjectInput,
  type SaveProjectOptions,
  type SnapshotRestoreTarget,
} from '../storageBackend';
import { FsAssetStore } from './assetFsStore';
import {
  compressJsonText,
  decompressData,
  decompressJsonText,
  PROJECT_LOCKS_DIR_NAME,
  ProjectFileLockedError,
  retryFs,
  StaleProjectWriterError,
  sanitizePathSegment,
  type TauriApis,
  withProjectFileLock,
  writeTextFileAtomic,
} from './fsCore';
import {
  evidenceFromPersistedMetadata,
  isLegacyInvalidProjectId,
  LEGACY_AUXILIARY_METADATA_KEY,
  LEGACY_PROJECT_DIRECTORY_METADATA_KEY,
  type LegacyAuxiliaryEvidence,
  legacyBinderAssetIds,
  legacyProjectContent,
  legacyProjectDirectory,
  legacyProjectWithDirectory,
  migratedProjectIdentity,
  type PersistedLegacyAuxiliaryMetadata,
  persistedLegacyAuxiliaryMetadata,
  persistedMetadataFromEvidence,
  persistedProjectId,
  projectPathSegment,
  type QuarantineLegacyAuxiliaryManifest,
  snapshotRestoreTargetDirectory,
} from './legacyProjectIdentity';

// QNBS-v3 (DA-01): distinguishes corrupt/unreadable saved data from genuine absence — callers must never treat this the same as "no project exists yet".
export class ProjectLoadError extends Error {
  constructor(
    public readonly reason: 'corrupt' | 'io-error' | 'unsupported-version',
    message: string,
    public readonly projectId: string,
    public readonly classification?: ProjectVersionClassification,
  ) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

// QNBS-v3: legacy admissions stay readable but cannot enter the ordinary writer until migration fencing exists.
export class ProjectWritebackError extends Error {
  constructor(public readonly projectId: string) {
    super(
      `Project "${projectId}" was loaded from an unversioned legacy source and cannot be saved until durable migration fencing is available.`,
    );
    this.name = 'ProjectWritebackError';
  }
}

// QNBS-v3 (#553): preserve the safe-save error boundary without exposing raw admission or generation details to UI callers.
export class ProjectCanonicalWritebackError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly detail: string,
  ) {
    super(
      'Project save was refused to preserve the stored data. Reload the project and try again.',
    );
    this.name = 'ProjectCanonicalWritebackError';
  }
}

// QNBS-v3: a stable deletion outcome keeps incomplete legacy cleanup retryable without exposing filesystem details.
export class ProjectDeleteError extends Error {
  constructor(
    public readonly reason:
      | 'cleanup-incomplete'
      | 'identity-inspection-failed' = 'cleanup-incomplete',
  ) {
    super(
      reason === 'identity-inspection-failed'
        ? 'Project deletion was not completed because its stored identity could not be safely verified.'
        : 'Project deletion was not completed because legacy auxiliary cleanup is incomplete; project data remains available for retry.',
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

export class ProjectSnapshotRestoreError extends Error {
  constructor(
    public readonly reason:
      | 'target-unavailable'
      | 'target-mismatch'
      | 'snapshot-unavailable'
      | 'snapshot-invalid'
      | 'snapshot-owner-mismatch'
      | 'snapshot-owner-unverifiable',
  ) {
    super(
      reason === 'target-mismatch'
        ? 'Snapshot restoration was not completed because the active project changed.'
        : reason === 'snapshot-invalid'
          ? 'Snapshot restoration was not completed because its contents are invalid.'
          : reason === 'snapshot-unavailable'
            ? 'Snapshot restoration was not completed because the snapshot could not be read.'
            : reason === 'snapshot-owner-mismatch'
              ? 'Snapshot restoration was not completed because it belongs to a different project.'
              : reason === 'snapshot-owner-unverifiable'
                ? 'Snapshot restoration was not completed because its project ownership could not be verified.'
                : 'Snapshot restoration was not completed because the current project target could not be safely verified.',
    );
    this.name = 'ProjectSnapshotRestoreError';
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

// QNBS-v3: reuse nested import validators while returning the original object so opaque fields remain present until raw-carrier writeback.
const storedProjectSchema = {
  safeParse(value: unknown): CanonicalProjectSchemaResult<StoryProject> {
    const result = importedProjectJsonSchema.safeParse(value);
    if (!result.success) {
      return {
        success: false,
        error: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      };
    }
    if (looksLikeStoryProject(value)) {
      return { success: true, data: value };
    }
    return {
      success: false,
      error: {
        issues: [
          {
            path: [],
            message: 'Stored project is missing the required project-owned fields.',
          },
        ],
      },
    };
  },
};

// QNBS-v3: keep the synthetic legacy-to-V1 marker out of editable state until fenced durable migration exists.
function withoutSyntheticLegacySchemaVersion(project: StoryProject): StoryProject {
  const projection = { ...(project as unknown as Record<string, unknown>) };
  delete projection['schemaVersion'];
  return projection as unknown as StoryProject;
}

// QNBS-v3: fresh writer output is explicitly CURRENT while legacy admissions remain fenced before this boundary.
function withCurrentSchemaVersion(project: StoryProject): StoryProject {
  const projection = { ...(project as unknown as Record<string, unknown>) };
  if (!Object.hasOwn(projection, 'schemaVersion')) {
    projection['schemaVersion'] = CURRENT_PROJECT_SCHEMA_VERSION;
  }
  return projection as unknown as StoryProject;
}

function canonicalWritebackRefusalDetail(
  writeback: Exclude<ProjectWritebackResult, { status: 'COMMITTED' }>,
): string {
  switch (writeback.status) {
    case 'CONFLICT':
      return 'source generation changed';
    case 'NOT_ADMITTED_FOR_WRITE':
      return writeback.classification;
    default:
      return writeback.reason;
  }
}

type LegacyAdmissionRecord = {
  sourceDirectoryId: string;
  persistedProjectId: string | null;
  sourceOwnedWriterIdentities: ReadonlySet<string>;
  sharedFallbackWriterIdentities: ReadonlySet<string>;
  writerIdentities: ReadonlySet<string>;
  editable: boolean;
};

const LEGACY_FALLBACK_WRITER_IDENTITIES = ['browser-project', 'default', 'project'] as const;

type ProjectAdmission = ReturnType<typeof admitCanonicalProjectDocument>;

// QNBS-v3 (#553): computed from the exact admitted raw the save path fences against, so an unchanged file always matches the baseline it seeds; null for anything not admitted as CURRENT (no baseline, i.e. unfenced as before).
type EditingBaseline = { generation: ProjectSourceGeneration; incarnation: string | null };

const PROJECT_INCARNATION_FILE_NAME = '.incarnation';
const INCARNATION_LOAD_ATTEMPTS = 3;

function newProjectIncarnation(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
}

function persistedIdOfRaw(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const id =
      parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)['id'] : undefined;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

// QNBS-v3 (#553): the editor's owned fields overlay the admitted carrier; the target-local routing metadata this save derived is written explicitly because the overlay only covers editor-owned paths.
function overlayAutosaveWriteback(
  projectToPersist: StoryProject,
  currentRaw: string,
): ProjectWritebackResult {
  const autosaveEdit = buildAutosaveOwnedProjectEdit(projectToPersist, currentRaw);
  const projectRecord = projectToPersist as unknown as Record<string, unknown>;
  const backendMetadata = Object.fromEntries(
    [LEGACY_PROJECT_DIRECTORY_METADATA_KEY, LEGACY_AUXILIARY_METADATA_KEY]
      .filter((key) => Object.hasOwn(projectRecord, key) && projectRecord[key] !== undefined)
      .map((key) => [key, projectRecord[key]]),
  );
  return commitOwnedProjectEdit({
    expectedGeneration: computeProjectSourceGeneration(currentRaw),
    currentRaw,
    edit: { ...autosaveEdit, fields: { ...autosaveEdit.fields, ...backendMetadata } },
  });
}

// QNBS-v3 (#553 a10): a replaced editor project is written whole, like a created one — nothing of the stored predecessor's text survives, and its routing metadata is only what saveProjectUnlocked derived for this target, never inherited from the file being replaced.
/** How an existing project file is replaced: null for an ordinary owned edit (#553 a10/a5). */
type ReplacementWrite = { readonly carrier: string | undefined } | null;

function replacementWriteOf(options: SaveProjectOptions | undefined): ReplacementWrite {
  return options?.replacement === true ? { carrier: options.replacementRaw } : null;
}

// QNBS-v3 (#553 a5): a restored project keeps the snapshot's own admitted text with the editor's edits applied — the same overlay an ordinary save uses, only onto the carrier instead of the file being replaced; without a carrier it is written whole.
function replacementWriteback(
  projectToPersist: StoryProject,
  replacement: NonNullable<ReplacementWrite>,
): ProjectWritebackResult {
  return replacement.carrier === undefined
    ? freshReplacementWriteback(projectToPersist)
    : overlayAutosaveWriteback(projectToPersist, replacement.carrier);
}

function freshReplacementWriteback(projectToPersist: StoryProject): ProjectWritebackResult {
  const raw = JSON.stringify(projectToPersist);
  const admission = admitCanonicalProjectDocument(raw, storedProjectSchema);
  const generation = currentGenerationOf(admission);
  if (generation === null) {
    return { status: 'NOT_ADMITTED_FOR_WRITE', classification: admission.source.classification };
  }
  return { status: 'COMMITTED', raw, generation };
}

function currentGenerationOf(admission: ProjectAdmission): ProjectSourceGeneration | null {
  return admission.status === 'CURRENT' && admission.canonical
    ? computeProjectSourceGeneration(admission.canonical.raw)
    : null;
}

// QNBS-v3 (#553): the directory an auxiliary write actually lands in — the same 'project' fallback the binder/codex path builders apply — used for both its lock and its baseline check so the two can never name different directories.
function auxiliaryTargetDirectory(projectId: string): string | null {
  return projectPathSegment(sanitizePathSegment(projectId, 'project'));
}

// QNBS-v3: one source-owned record keeps the canonical directory, embedded identity, aliases, and write verdict together.
export class FsProjectStore extends FsAssetStore {
  private readonly verifiedLegacyProjectDirectories = new Set<string>();
  private readonly legacyAdmissionRecords = new Map<string, LegacyAdmissionRecord>();
  // QNBS-v3 (#553): the canonical generation and project incarnation this process's editable in-memory project descends from, per project — set only by the editing load and by this process's own commits, never by background reads (backup/LoRA use loadProject), so a background re-read can never mask a stale writer.
  private readonly editingBaselines = new Map<string, EditingBaseline>();
  // QNBS-v3 (#553 §2.8): the project directory this window's editor is working on — the identity a project without a persisted id cannot carry itself. Set by the editing load and by this window's own saves.
  private editingSourceId: string | null = null;

  private setEditingBaseline(projectId: string, baseline: EditingBaseline | null): void {
    if (baseline === null) this.editingBaselines.delete(projectId);
    else this.editingBaselines.set(projectId, baseline);
  }

  // QNBS-v3 (#553): a random per-creation token beside project.json. Delete and quarantine take it with the directory and every create writes a fresh one, so a deleted-then-recreated project never matches an old window even when its project.json is byte-identical. Projects created before this token existed have none (null) until recreated; that still differs from any fresh token.
  private async readProjectIncarnation(
    apis: TauriApis,
    safeProjectId: string,
  ): Promise<string | null> {
    const appDataPath = await this.ensureAppDataPath();
    const incarnationFile = await apis.join(
      appDataPath,
      'projects',
      safeProjectId,
      PROJECT_INCARNATION_FILE_NAME,
    );
    if (!(await apis.exists(incarnationFile))) return null;
    const token = (await retryFs(() => apis.readTextFile(incarnationFile))).trim();
    return token === '' ? null : token;
  }

  private writerIdentityAliases(projectId: string): Set<string> {
    const identities = new Set([projectId]);
    const safeProjectId = projectPathSegment(projectId);
    if (safeProjectId) identities.add(safeProjectId);
    return identities;
  }

  private registerLegacyAdmission(sourceDirectoryId: string, project: StoryProject): void {
    const persistedId = persistedProjectId(project);
    const sourceOwnedWriterIdentities = new Set<string>([sourceDirectoryId]);
    const sharedFallbackWriterIdentities = new Set<string>();
    if (typeof persistedId === 'string') {
      sourceOwnedWriterIdentities.add(persistedId);
      const safePersistedId = projectPathSegment(persistedId);
      if (safePersistedId) sourceOwnedWriterIdentities.add(safePersistedId);
      if (!safePersistedId) {
        for (const fallback of LEGACY_FALLBACK_WRITER_IDENTITIES) {
          sourceOwnedWriterIdentities.add(fallback);
        }
      }
    } else {
      // QNBS-v3: an ID-less legacy inspection is read-only; shared fallback names must not become global write claims that can block an unrelated CURRENT source.
    }
    const writerIdentities = new Set([
      ...sourceOwnedWriterIdentities,
      ...sharedFallbackWriterIdentities,
    ]);
    this.legacyAdmissionRecords.set(sourceDirectoryId, {
      sourceDirectoryId,
      persistedProjectId: typeof persistedId === 'string' ? persistedId : null,
      sourceOwnedWriterIdentities,
      sharedFallbackWriterIdentities,
      writerIdentities,
      editable: false,
    });
  }

  private clearLegacyAdmissionForSource(sourceDirectoryId: string): void {
    this.legacyAdmissionRecords.delete(sourceDirectoryId);
    for (const [recordSource, record] of this.legacyAdmissionRecords) {
      const sourceOwnedWriterIdentities = new Set(
        [...record.sourceOwnedWriterIdentities].filter(
          (identity) => projectPathSegment(identity) !== sourceDirectoryId,
        ),
      );
      if (sourceOwnedWriterIdentities.size === record.sourceOwnedWriterIdentities.size) {
        continue;
      }
      const writerIdentities = new Set([
        ...sourceOwnedWriterIdentities,
        ...record.sharedFallbackWriterIdentities,
      ]);
      if (writerIdentities.size === 0) {
        this.legacyAdmissionRecords.delete(recordSource);
      } else {
        this.legacyAdmissionRecords.set(recordSource, {
          ...record,
          sourceOwnedWriterIdentities,
          writerIdentities,
        });
      }
    }
  }

  private legacyAdmissionsForWriter(projectId: string): LegacyAdmissionRecord[] {
    const aliases = this.writerIdentityAliases(projectId);
    return [...this.legacyAdmissionRecords.values()].filter((record) =>
      [...aliases].some((identity) => record.writerIdentities.has(identity)),
    );
  }

  private async currentProjectSourceIsAdmitted(sourceDirectoryId: string): Promise<boolean> {
    const projectFileId = projectPathSegment(sourceDirectoryId);
    if (!projectFileId) return false;
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const projectFile = await apis.join(appDataPath, 'projects', projectFileId, 'project.json');
      if (!(await apis.exists(projectFile))) return false;
      const admission = admitCanonicalProjectDocument(
        decompressJsonText(await retryFs(() => apis.readTextFile(projectFile))),
        storedProjectSchema,
      );
      return admission.status === 'CURRENT' && admission.canonical?.projection !== null;
    } catch {
      return false;
    }
  }

  // QNBS-v3: current-source validation may release only aliases proven to belong to that current source.
  protected override async assertProjectWriteAuthority(projectId: string): Promise<void> {
    const admissions = this.legacyAdmissionsForWriter(projectId);
    if (admissions.length === 0) return;

    const aliases = this.writerIdentityAliases(projectId);
    const hasSharedFallbackConflict = admissions.some((record) =>
      [...aliases].some((identity) => record.sharedFallbackWriterIdentities.has(identity)),
    );
    if (hasSharedFallbackConflict) {
      throw new ProjectWritebackError(projectId);
    }

    const sourceDirectoryId = projectPathSegment(projectId);
    if (sourceDirectoryId && (await this.currentProjectSourceIsAdmitted(sourceDirectoryId))) {
      this.clearLegacyAdmissionForSource(sourceDirectoryId);
      return;
    }
    throw new ProjectWritebackError(projectId);
  }

  protected override isProjectWriteAuthorityError(error: unknown): boolean {
    return (
      error instanceof ProjectWritebackError ||
      error instanceof ProjectCanonicalWritebackError ||
      error instanceof StaleProjectWriterError ||
      error instanceof ProjectFileLockedError
    );
  }

  // QNBS-v3 (#553): takes every lock in one sorted order so two multi-directory operations cannot hold each other's first lock.
  private async withProjectLocks<T>(
    projectIds: readonly string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    const safeIds = [...new Set(projectIds.map(auxiliaryTargetDirectory))]
      .filter((id): id is string => !!id)
      .sort();
    if (safeIds.length === 0) return fn();
    const apis = await this.getApis();
    const lockAndRun = async (index: number): Promise<T> => {
      const safeId = safeIds[index];
      if (safeId === undefined) return fn();
      const lockKeyPath = await this.projectLockKeyPath(apis, safeId);
      return withProjectFileLock(apis, lockKeyPath, () => lockAndRun(index + 1));
    };
    return lockAndRun(0);
  }

  // QNBS-v3 (#553): every write locks its logical and routed directories, even without a baseline, so a delete or quarantine can never interleave with it; directories this window holds a baseline for must also still match disk (the saveProject verdict). No baseline (never edit-loaded, or deleted by this window) skips only the generation check.
  protected override async runFencedAuxiliaryWrite<T>(
    fenceProjectIds: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.withProjectLocks(fenceProjectIds, async () => {
      const apis = await this.getApis();
      for (const id of fenceProjectIds) {
        const safeId = auxiliaryTargetDirectory(id);
        const baseline = safeId ? this.editingBaselines.get(safeId) : undefined;
        if (safeId && baseline !== undefined) {
          await this.assertProjectSourceMatches(apis, safeId, baseline);
        }
      }
      return operation();
    });
  }

  private async assertProjectSourceMatches(
    apis: TauriApis,
    safeProjectId: string,
    baseline: EditingBaseline,
  ): Promise<void> {
    const appDataPath = await this.ensureAppDataPath();
    const projectFile = await apis.join(appDataPath, 'projects', safeProjectId, 'project.json');
    let exists: boolean;
    let raw = '';
    let incarnation: string | null = null;
    try {
      exists = await apis.exists(projectFile);
      if (exists) {
        raw = decompressJsonText(await retryFs(() => apis.readTextFile(projectFile)));
        incarnation = await this.readProjectIncarnation(apis, safeProjectId);
      }
    } catch (error) {
      // QNBS-v3 (#553): an unreadable fence is an authority error, not a generic failure the delete wrappers would log and report as done.
      throw new ProjectCanonicalWritebackError(
        safeProjectId,
        `stale-writer fence could not read the project file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!exists) throw new StaleProjectWriterError(safeProjectId);
    if (
      currentGenerationOf(admitCanonicalProjectDocument(raw, storedProjectSchema)) !==
        baseline.generation ||
      incarnation !== baseline.incarnation
    ) {
      throw new StaleProjectWriterError(safeProjectId);
    }
  }

  private canonicalLegacyProjection(
    project: StoryProject,
    sourceDirectoryId: string,
  ): StoryProject {
    const persistedId = persistedProjectId(project);
    const safePersistedId =
      typeof persistedId === 'string' ? projectPathSegment(persistedId) : null;
    if (safePersistedId && safePersistedId !== sourceDirectoryId) {
      return {
        ...project,
        id: sourceDirectoryId,
        [LEGACY_PROJECT_DIRECTORY_METADATA_KEY]: sourceDirectoryId,
      } as StoryProject;
    }
    return project;
  }

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
            ((legacyCodex as Record<string, unknown>)['projectId'] === rawProjectId ||
              (legacyCodex as Record<string, unknown>)['projectId'] === safeProjectId)
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
    const rawProjectId = persistedProjectId(project);
    if (typeof rawProjectId === 'string' && projectPathSegment(rawProjectId)) {
      if (!persistedMetadata) this.clearLegacyPoliciesTargetingProject(safeProjectId);
      return project;
    }

    if (typeof rawProjectId !== 'string') {
      this.clearLegacyAuxiliaryPolicy(safeProjectId);
      if (legacyProjectDirectory(project) === safeProjectId) {
        this.verifiedLegacyProjectDirectories.add(safeProjectId);
        return project;
      }
      this.verifiedLegacyProjectDirectories.add(safeProjectId);
      // QNBS-v3: retain the source directory for every missing-ID load so a later save cannot drift to a title-derived path.
      return legacyProjectWithDirectory(project, safeProjectId);
    }

    if (!projectPathSegment(rawProjectId)) {
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
    if (legacyProjectContent(existingProject) !== legacyProjectContent(project)) return null;

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

  async restoreSnapshot(
    snapshotId: number,
    currentProject: SnapshotRestoreTarget,
  ): Promise<RestoredSnapshot<StoryProject>> {
    // QNBS-v3: serialize target validation and snapshot ownership checks so routing cannot change mid-restore.
    return this.withLegacyRoutingOperation(() =>
      this.restoreSnapshotUnlocked(snapshotId, currentProject),
    );
  }

  private async restoreSnapshotUnlocked(
    snapshotId: number,
    currentProject: SnapshotRestoreTarget,
  ): Promise<RestoredSnapshot<StoryProject>> {
    const targetDirectory = snapshotRestoreTargetDirectory(currentProject);
    if (!targetDirectory) {
      throw new ProjectSnapshotRestoreError('target-unavailable');
    }

    let validatedTarget: StoryProject | null;
    try {
      validatedTarget = await this.loadProjectUnlocked(targetDirectory);
    } catch (error) {
      logger.error('Failed to validate the snapshot restore target', {
        projectId: targetDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectSnapshotRestoreError('target-unavailable');
    }
    if (!validatedTarget) {
      throw new ProjectSnapshotRestoreError('target-unavailable');
    }
    try {
      await this.assertProjectWriteAuthority(targetDirectory);
    } catch {
      throw new ProjectSnapshotRestoreError('target-unavailable');
    }

    let snapshotJson: string | null;
    try {
      snapshotJson = await this.getSnapshotJsonText(snapshotId);
    } catch (error) {
      logger.error('Failed to read snapshot for restore', {
        snapshotId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectSnapshotRestoreError('snapshot-unavailable');
    }
    if (snapshotJson === null) {
      throw new ProjectSnapshotRestoreError('snapshot-unavailable');
    }

    // QNBS-v3: admit decompressed snapshot text before parsing so duplicate and unsafe version tokens remain visible to the canonical gate.
    const snapshotAdmission = admitCanonicalProjectDocument(snapshotJson, storedProjectSchema);
    const admittedSnapshot = snapshotAdmission.canonical?.projection;
    if (snapshotAdmission.status === 'REFUSED' || !admittedSnapshot) {
      throw new ProjectSnapshotRestoreError('snapshot-invalid');
    }

    const snapshotProjectId = persistedProjectId(admittedSnapshot);
    if (typeof snapshotProjectId !== 'string') {
      throw new ProjectSnapshotRestoreError('snapshot-owner-unverifiable');
    }
    const safeSnapshotProjectId = projectPathSegment(snapshotProjectId);
    if (!safeSnapshotProjectId) {
      throw new ProjectSnapshotRestoreError('snapshot-owner-unverifiable');
    }
    if (safeSnapshotProjectId !== targetDirectory) {
      throw new ProjectSnapshotRestoreError('snapshot-owner-mismatch');
    }

    // QNBS-v3 (#553 §2.8): identity and machine-local metadata come from the restore target, set on the snapshot's own admitted text so every other field keeps its stored content.
    const fields: Record<string, unknown> = {};
    const removeFields: string[] = [
      'id',
      LEGACY_PROJECT_DIRECTORY_METADATA_KEY,
      LEGACY_AUXILIARY_METADATA_KEY,
    ];
    const validatedTargetId = persistedProjectId(validatedTarget);
    if (typeof validatedTargetId === 'string') {
      const safeTargetId = projectPathSegment(validatedTargetId);
      if (!safeTargetId || safeTargetId !== targetDirectory) {
        throw new ProjectSnapshotRestoreError('target-unavailable');
      }
      fields['id'] = safeTargetId;
    }
    const validatedTargetDirectory = legacyProjectDirectory(validatedTarget);
    if (validatedTargetDirectory) {
      fields[LEGACY_PROJECT_DIRECTORY_METADATA_KEY] = validatedTargetDirectory;
    }
    const validatedTargetMetadata = persistedLegacyAuxiliaryMetadata(validatedTarget);
    if (validatedTargetMetadata) {
      fields[LEGACY_AUXILIARY_METADATA_KEY] = validatedTargetMetadata;
    }
    const snapshotRaw = snapshotAdmission.canonical?.raw;
    if (snapshotRaw === undefined) throw new ProjectSnapshotRestoreError('snapshot-invalid');
    const restoredText = commitOwnedProjectEdit({
      expectedGeneration: computeProjectSourceGeneration(snapshotRaw),
      currentRaw: snapshotRaw,
      edit: { fields, removeFields: removeFields.filter((key) => !Object.hasOwn(fields, key)) },
    });
    if (restoredText.status !== 'COMMITTED') {
      throw new ProjectSnapshotRestoreError('snapshot-invalid');
    }
    // QNBS-v3 (#553 a5): admission only — the exact admitted text is returned, never kept here; the thunk binds it after its live identity check and the replacement save persists it through the persistence coordinator.
    return { project: JSON.parse(restoredText.raw) as StoryProject, raw: restoredText.raw };
  }

  async saveProject(project: SaveProjectInput, options?: SaveProjectOptions): Promise<void> {
    return this.withLegacyRoutingOperation(() =>
      this.saveProjectUnlocked(project, replacementWriteOf(options)),
    );
  }

  // QNBS-v3 (#553): the existence check AND both the create-new and existing-project branches run under one cross-process lock — locking only the existing-project branch left a same-shape race where two processes could both observe an absent project.json and independently perform atomic creation, the later one silently overwriting the earlier.
  // QNBS-v3 (#553): ProjectFileLockedError propagates as itself, not wrapped into ProjectCanonicalWritebackError — nothing in app/features/hooks/components checks either type today, so this changes no existing behavior, and it lets a caller distinguish "another writer currently holds the lock" from every other writeback-refusal cause for a truthful, actionable notification instead of the same generic message for both.
  private async persistProjectFile(
    apis: TauriApis,
    projectFile: string,
    projectId: string,
    projectToPersist: StoryProject,
    replacement: ReplacementWrite,
  ): Promise<string> {
    const lockKeyPath = await this.projectLockKeyPath(apis, projectId);
    return withProjectFileLock(apis, lockKeyPath, () =>
      this.persistProjectFileLocked(apis, projectFile, projectId, projectToPersist, replacement),
    );
  }

  // QNBS-v3 (#553): the lock lives outside projects/<id>/ deliberately — quarantineProjectUnlocked's rename and deleteProjectUnlocked's recursive remove both operate on exactly that directory, so a sibling lock file there could be relocated or deleted out from under its owner, letting a concurrent writer wrongly conclude the path is free. A stable sibling of projects/ and quarantined-projects/ is untouched by either operation.
  private async projectLockKeyPath(apis: TauriApis, projectId: string): Promise<string> {
    const appDataPath = await this.ensureAppDataPath();
    const locksRoot = await apis.join(appDataPath, PROJECT_LOCKS_DIR_NAME);
    await apis.mkdir(locksRoot, { recursive: true });
    return apis.join(locksRoot, projectId);
  }

  private async persistProjectFileLocked(
    apis: TauriApis,
    projectFile: string,
    projectId: string,
    projectToPersist: StoryProject,
    replacement: ReplacementWrite,
  ): Promise<string> {
    let sourceExists: boolean;
    try {
      sourceExists = await apis.exists(projectFile);
    } catch (error) {
      throw new ProjectCanonicalWritebackError(
        projectId,
        `filesystem source inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // QNBS-v3 (#553): create absent project files directly; preserve the admitted raw carrier when replacing an existing source.
    // QNBS-v3 (#553): a missing file while this window still holds a baseline means another window deleted or quarantined the project after this one loaded it — recreating it from this window's snapshot would resurrect deliberately removed data. This window's own delete/quarantine forgets its baseline first, so only a genuinely new project reaches the create branch.
    if (!sourceExists && this.editingBaselines.has(projectId)) {
      throw new StaleProjectWriterError(projectId);
    }
    if (!sourceExists) {
      // QNBS-v3 (#553): the creating window owns the file it just wrote — clearing its baseline instead would leave it unfenced if another window opened and saved the new file before this window's next save. Computed before writing, through the same admission a later read applies, so no failure can follow a completed write.
      const createdJson = JSON.stringify(projectToPersist);
      const createdGeneration = currentGenerationOf(
        admitCanonicalProjectDocument(createdJson, storedProjectSchema),
      );
      // QNBS-v3 (#553): the fresh incarnation lands before project.json, so the project never exists on disk without the token a later window will load.
      const incarnation = newProjectIncarnation();
      const appDataPath = await this.ensureAppDataPath();
      await writeTextFileAtomic(
        apis,
        await apis.join(appDataPath, 'projects', projectId, PROJECT_INCARNATION_FILE_NAME),
        incarnation,
      );
      await writeTextFileAtomic(apis, projectFile, compressJsonText(createdJson));
      this.setEditingBaseline(
        projectId,
        createdGeneration === null ? null : { generation: createdGeneration, incarnation },
      );
      this.editingSourceId = projectId;
      return createdJson;
    }
    return this.persistExistingCanonicalProjectLocked(
      apis,
      projectFile,
      projectId,
      projectToPersist,
      replacement,
    );
  }

  private async persistExistingCanonicalProjectLocked(
    apis: TauriApis,
    projectFile: string,
    projectId: string,
    projectToPersist: StoryProject,
    replacement: ReplacementWrite,
  ): Promise<string> {
    // QNBS-v3 (#553): keep existing-project writeback as one preserve-first raw-carrier transaction boundary.
    let currentRaw: string;
    try {
      currentRaw = decompressJsonText(await retryFs(() => apis.readTextFile(projectFile)));
    } catch (error) {
      throw new ProjectCanonicalWritebackError(
        projectId,
        `filesystem source read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const admission = admitCanonicalProjectDocument(currentRaw, storedProjectSchema);
    if (admission.status !== 'CURRENT' || admission.canonical === null) {
      throw new ProjectCanonicalWritebackError(
        projectId,
        `filesystem source is not admitted: ${admission.source.classification}`,
      );
    }
    // QNBS-v3 (#553): refuse before building the overlay — the edit below is fenced only against the carrier read now, so an independently-loaded window whose snapshot predates the current generation would otherwise pass that fence and silently revert fields another window committed.
    const currentGeneration = computeProjectSourceGeneration(admission.canonical.raw);
    let currentIncarnation: string | null;
    try {
      currentIncarnation = await this.readProjectIncarnation(apis, projectId);
    } catch (error) {
      throw new ProjectCanonicalWritebackError(
        projectId,
        `project incarnation read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const baseline = this.editingBaselines.get(projectId);
    if (
      baseline !== undefined &&
      (baseline.generation !== currentGeneration || baseline.incarnation !== currentIncarnation)
    ) {
      throw new StaleProjectWriterError(projectId);
    }
    const writeback = replacement
      ? replacementWriteback(projectToPersist, replacement)
      : overlayAutosaveWriteback(projectToPersist, admission.canonical.raw);
    if (writeback.status !== 'COMMITTED') {
      throw new ProjectCanonicalWritebackError(
        projectId,
        `filesystem canonical writeback refused: ${canonicalWritebackRefusalDetail(writeback)}`,
      );
    }
    try {
      const expectedGeneration = currentGeneration;
      await writeTextFileAtomic(apis, projectFile, compressJsonText(writeback.raw), async () => {
        // QNBS-v3 (#553): re-read immediately before rename as defense-in-depth even under the lock — a corrupted/foreign lock file would otherwise be the only thing standing between two writers.
        const latestRaw = decompressJsonText(await retryFs(() => apis.readTextFile(projectFile)));
        if (computeProjectSourceGeneration(latestRaw) !== expectedGeneration) {
          throw new Error('source generation changed before atomic replacement');
        }
      });
      this.editingBaselines.set(projectId, {
        generation: writeback.generation,
        incarnation: currentIncarnation,
      });
      this.editingSourceId = projectId;
    } catch (error) {
      throw new ProjectCanonicalWritebackError(
        projectId,
        `filesystem canonical replacement failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return writeback.raw;
  }

  private async saveProjectUnlocked(
    project: SaveProjectInput,
    replacement: ReplacementWrite,
  ): Promise<void> {
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
        if (legacyIdentity.metadata) {
          this.registerLegacyAuxiliaryPolicy(
            projectId,
            legacyIdentity.metadata.legacyProjectId,
            evidenceFromPersistedMetadata(legacyIdentity.metadata),
          );
        }
      } else {
        projectId = safeProjectId;
      }
    } else {
      const legacyDirectory = legacyProjectDirectory(flat);
      projectId =
        legacyDirectory && this.verifiedLegacyProjectDirectories.has(legacyDirectory)
          ? legacyDirectory
          : (projectPathSegment(flat.title || '') ?? 'project');
    }

    await this.assertProjectWriteAuthority(projectId);
    if (suppliedProjectId) {
      this.verifiedLegacyProjectDirectories.delete(projectId);
    }

    projectToPersist = withCurrentSchemaVersion(projectToPersist);

    const projectPath = await apis.join(appDataPath, 'projects', projectId);

    if (!(await apis.exists(projectPath))) {
      await apis.mkdir(projectPath, { recursive: true });
    }

    const projectFile = await apis.join(projectPath, 'project.json');
    const committedRaw = await this.persistProjectFile(
      apis,
      projectFile,
      projectId,
      projectToPersist,
      replacement,
    );
    // QNBS-v3 (#553): capture recovery state only after authoritative replacement succeeds, so a refused save cannot mutate snapshot history — and capture the exact text just committed (§2.8), not a re-serialized parse of the input.
    if (Date.now() - this.lastAutoSnapshotTime > this.AUTO_SNAPSHOT_INTERVAL) {
      this.lastAutoSnapshotTime = Date.now();
      this.saveSnapshotText('auto', committedRaw)
        .then(() => this.pruneAutoSnapshots())
        .catch((error) => {
          // QNBS-v3: auto-snapshot failure stays non-fatal while remaining visible for recovery diagnostics.
          logger.warn('Auto-snapshot failed (project save itself is unaffected)', {
            projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    this.clearLegacyPoliciesTargetingProject(projectId);
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
    return this.withLegacyRoutingOperation(() => this.loadProjectUnlocked(projectId));
  }

  // QNBS-v3 (#553 §2.8): the admitted raw carrier from ONE read of project.json — the persisted text, including integer literals a parse would round; its readable form must be derived from this same text, never from a second read.
  async loadCanonicalProjectRaw(projectId: string): Promise<CanonicalProjectRawResult> {
    return this.withLegacyRoutingOperation(async () => {
      const { raw } = await this.readAdmittedCarrier(projectId);
      return raw === null ? { status: 'ABSENT' } : { status: 'CURRENT', raw };
    });
  }

  // QNBS-v3 (#553 §2.8): the editor's own project, resolved to the directory it was loaded from, and refused as STALE under the same generation + incarnation verdict saveProject applies — an export from a window another window moved past would otherwise mix that window's older edits into newer stored data.
  async loadEditorExportCarrier(projectId: string | undefined): Promise<CanonicalProjectRawResult> {
    return this.withLegacyRoutingOperation(async () => {
      const sourceId = await this.resolveEditorSourceId(projectId);
      if (sourceId === null) return { status: 'REFUSED', classification: 'UNKNOWN_SOURCE' };
      const apis = await this.getApis();
      const baseline = this.editingBaselines.get(sourceId);
      const incarnationBefore = await this.readProjectIncarnation(apis, sourceId);
      const { raw, generation } = await this.readAdmittedCarrier(sourceId);
      const incarnationAfter = await this.readProjectIncarnation(apis, sourceId);
      if (incarnationBefore !== incarnationAfter) return { status: 'STALE' };
      if (raw === null) return baseline ? { status: 'STALE' } : { status: 'ABSENT' };
      if (
        baseline &&
        (baseline.generation !== generation || baseline.incarnation !== incarnationAfter)
      ) {
        return { status: 'STALE' };
      }
      return { status: 'CURRENT', raw };
    });
  }

  private async readAdmittedCarrier(
    projectId: string,
  ): Promise<{ raw: string | null; generation: ProjectSourceGeneration | null }> {
    let raw: string | null = null;
    let generation: ProjectSourceGeneration | null = null;
    const project = await this.loadProjectUnlocked(projectId, (admittedGeneration, admittedRaw) => {
      raw = admittedRaw;
      generation = admittedGeneration;
    });
    return project ? { raw, generation } : { raw: null, generation: null };
  }

  private forgetEditingProject(safeProjectId: string): void {
    this.editingBaselines.delete(safeProjectId);
    if (this.editingSourceId === safeProjectId) this.editingSourceId = null;
  }

  // QNBS-v3 (#553 §2.8): a persisted id names its directory unless the editor loaded a legacy directory whose stored id differs from its name; an id-less (or empty-id) project is identified only by the editing load.
  private async resolveEditorSourceId(projectId: string | undefined): Promise<string | null> {
    const idSegment = projectId ? projectPathSegment(projectId) : null;
    const editing = this.editingSourceId;
    if (editing === null || idSegment === editing) return idSegment ?? editing;
    if (idSegment === null) return editing;
    const { raw } = await this.readAdmittedCarrier(editing);
    const editingId = raw === null ? null : persistedIdOfRaw(raw);
    return editingId === projectId ? editing : idSegment;
  }

  // QNBS-v3: desktop bootstrap uses a distinct admission boundary so a readable legacy projection cannot enter the ordinary editable Redux store.
  async loadProjectForEditing(projectId: string): Promise<StoryProject | null> {
    return this.withLegacyRoutingOperation(async () => {
      const safeProjectId = projectPathSegment(projectId);
      let { project, generation, incarnation } = await this.loadProjectWithIncarnation(
        projectId,
        safeProjectId,
      );
      // QNBS-v3 (#553 R3): a legacy (unversioned) file enters editing only through its durable LEGACY_TO_V1 migration — committed under the project lock and source fences, then reloaded through the ordinary CURRENT path.
      if (project && safeProjectId && this.legacyAdmissionRecords.has(safeProjectId)) {
        await this.commitLegacyToV1Migration(projectId, safeProjectId, incarnation);
        ({ project, generation, incarnation } = await this.loadProjectWithIncarnation(
          projectId,
          safeProjectId,
        ));
      }
      if (project && safeProjectId && this.legacyAdmissionRecords.has(safeProjectId)) {
        throw new ProjectLoadError(
          'unsupported-version',
          `The legacy project file for "${projectId}" is readable but cannot enter the editable application state. The file has not been changed.`,
          projectId,
          'LEGACY_UNVERSIONED',
        );
      }
      if (safeProjectId) {
        this.setEditingBaseline(
          safeProjectId,
          project && generation !== null ? { generation, incarnation } : null,
        );
        if (project) this.editingSourceId = safeProjectId;
      }
      return project;
    });
  }

  /**
   * Durable LEGACY_TO_V1 for a filesystem project (#553 R3, contract §2.4 / row 11).
   *
   * Under the project lock it re-reads the file, checks it is still the legacy source that was
   * loaded (same incarnation, still LEGACY_TO_V1), keeps the exact legacy text as a "Before schema
   * migration" snapshot, verifies the admitted overlay (the legacy text with `schemaVersion` added,
   * nothing else changed) admits as CURRENT, and replaces the file atomically only if its text is
   * unchanged at rename. Any failure leaves the legacy file as it was; a concurrent migration that
   * already committed is a no-op.
   */
  private async commitLegacyToV1Migration(
    projectId: string,
    safeProjectId: string,
    loadedIncarnation: string | null,
  ): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const projectFile = await apis.join(appDataPath, 'projects', safeProjectId, 'project.json');
    const lockKeyPath = await this.projectLockKeyPath(apis, safeProjectId);
    await withProjectFileLock(apis, lockKeyPath, async () => {
      if ((await this.readProjectIncarnation(apis, safeProjectId)) !== loadedIncarnation) {
        throw new StaleProjectWriterError(safeProjectId);
      }
      const sourceText = decompressJsonText(await retryFs(() => apis.readTextFile(projectFile)));
      const admission = admitCanonicalProjectDocument(sourceText, storedProjectSchema);
      if (admission.status !== 'LEGACY_TO_V1' || admission.canonical === null) return;
      const migratedRaw = admission.canonical.raw;
      if (admitCanonicalProjectDocument(migratedRaw, storedProjectSchema).status !== 'CURRENT') {
        throw new ProjectCanonicalWritebackError(
          projectId,
          'legacy migration did not produce a CURRENT document',
        );
      }
      await this.saveSnapshotText('Before schema migration', sourceText);
      await writeTextFileAtomic(apis, projectFile, compressJsonText(migratedRaw), async () => {
        const latest = decompressJsonText(await retryFs(() => apis.readTextFile(projectFile)));
        if (latest !== sourceText) throw new Error('legacy source changed before migration commit');
      });
    });
  }

  // QNBS-v3 (#553): the token is read on both sides of the project read; a delete-and-recreate landing in between changes it, and that load is retried instead of pairing the old document with the new incarnation.
  private async loadProjectWithIncarnation(
    projectId: string,
    safeProjectId: string | null,
  ): Promise<{
    project: StoryProject | null;
    generation: ProjectSourceGeneration | null;
    incarnation: string | null;
  }> {
    const apis = await this.getApis();
    const readIncarnation = async (): Promise<string | null> => {
      if (!safeProjectId) return null;
      try {
        return await this.readProjectIncarnation(apis, safeProjectId);
      } catch {
        throw new ProjectLoadError(
          'io-error',
          `The project identity for "${projectId}" could not be read. The file has not been changed.`,
          projectId,
        );
      }
    };
    for (let attempt = 0; attempt < INCARNATION_LOAD_ATTEMPTS; attempt++) {
      const before = await readIncarnation();
      let generation: ProjectSourceGeneration | null = null;
      const project = await this.loadProjectUnlocked(projectId, (loadedGeneration) => {
        generation = loadedGeneration;
      });
      if ((await readIncarnation()) === before) return { project, generation, incarnation: before };
    }
    throw new ProjectLoadError(
      'io-error',
      `The project "${projectId}" kept being replaced while it was loading. The file has not been changed.`,
      projectId,
    );
  }

  private async loadProjectUnlocked(
    projectId: string,
    onCanonicalGeneration?: (generation: ProjectSourceGeneration | null, raw: string) => void,
  ): Promise<StoryProject | null> {
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
        this.clearLegacyAdmissionForSource(safeProjectId);
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
    let classification: ProjectVersionClassification | undefined;
    let legacyAdmission = false;
    try {
      const admission = admitCanonicalProjectDocument(
        decompressJsonText(content),
        storedProjectSchema,
      );
      legacyAdmission = admission.status === 'LEGACY_TO_V1';
      classification = admission.source.classification;
      if (admission.canonical?.projection === null || admission.canonical === null) {
        throw new Error(
          admission.source.error ??
            `Project admission refused for ${admission.source.classification} input.`,
        );
      }
      project =
        admission.status === 'LEGACY_TO_V1'
          ? withoutSyntheticLegacySchemaVersion(admission.canonical.projection)
          : admission.canonical.projection;
      onCanonicalGeneration?.(currentGenerationOf(admission), admission.canonical.raw);
    } catch (error) {
      logger.error('Failed to parse project file (corrupt data):', error);
      throw new ProjectLoadError(
        classification && classification !== 'MALFORMED' ? 'unsupported-version' : 'corrupt',
        classification && classification !== 'MALFORMED'
          ? 'The saved project file for "' +
              projectId +
              '" was refused as ' +
              classification +
              '. The file has not been changed.'
          : 'The saved project file for "' +
              projectId +
              '" appears to be corrupted and could not be read. The file has not been deleted.',
        projectId,
        classification,
      );
    }

    // QNBS-v3: admission remains non-destructive until durable migration and raw-carrier writeback are fenced.
    const migratedProject = await this.migrateLegacyProjectIdentity(
      project,
      safeProjectId,
      apis,
      appDataPath,
    );
    if (legacyAdmission) {
      this.registerLegacyAdmission(safeProjectId, project);
    } else {
      this.clearLegacyAdmissionForSource(safeProjectId);
    }
    scheduleCoreProjectValidation(migratedProject);
    return legacyAdmission
      ? this.canonicalLegacyProjection(migratedProject, safeProjectId)
      : migratedProject;
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
  private async prepareLegacyQuarantinePolicy(
    safeProjectId: string,
    apis: TauriApis,
    appDataPath: string,
  ): Promise<{
    legacyProjectId: string;
    codex: boolean;
    binderAssetIds: readonly string[];
  } | null> {
    const policy = this.legacyAuxiliaryPolicyForProject(safeProjectId);
    if (policy?.legacyProjectId !== 'project') return policy;
    const legacyProjectState = await this.legacyFallbackProjectState(
      safeProjectId,
      apis,
      appDataPath,
    );
    if (legacyProjectState === 'confirmed') {
      this.clearLegacyAuxiliaryPolicy(safeProjectId);
      return null;
    }
    if (legacyProjectState === 'indeterminate') throw new ProjectQuarantineError('io-error');
    return policy;
  }

  async quarantineProject(projectId: string): Promise<ProjectQuarantineResult> {
    return this.withLegacyRoutingOperation(async () => {
      try {
        return await this.withProjectLockFor(projectId, () =>
          this.quarantineProjectUnlocked(projectId),
        );
      } catch (error) {
        if (!(error instanceof ProjectFileLockedError)) throw error;
        logger.error('Project quarantine blocked by another writer holding the project lock', {
          projectId,
        });
        throw new ProjectQuarantineError('io-error');
      }
    });
  }

  // QNBS-v3 (#553): destructive project operations take the lock fenced auxiliary writes hold, so a check that passed cannot be invalidated by a delete or quarantine before that write finishes.
  private async withProjectLockFor<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const safeProjectId = projectPathSegment(projectId);
    if (!safeProjectId) return fn();
    const apis = await this.getApis();
    return withProjectFileLock(apis, await this.projectLockKeyPath(apis, safeProjectId), fn);
  }

  private async quarantineProjectUnlocked(projectId: string): Promise<ProjectQuarantineResult> {
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
      const legacyPolicy = await this.prepareLegacyQuarantinePolicy(
        safeProjectId,
        apis,
        appDataPath,
      );
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
          if (legacyPolicy?.legacyProjectId === 'project') {
            const manifestPath = await apis.join(quarantinePath, 'legacy-auxiliary.json');
            const manifest: QuarantineLegacyAuxiliaryManifest = {
              projectId: safeProjectId,
              legacyProjectId: legacyPolicy.legacyProjectId,
              codex: legacyPolicy.codex,
              binderAssetIds: [...legacyPolicy.binderAssetIds],
            };
            // QNBS-v3: durable quarantine metadata preserves verified auxiliary provenance without claiming ownership of ambiguous fallback files.
            await writeTextFileAtomic(apis, manifestPath, JSON.stringify(manifest));
          }
          await retryFs(() => apis.rename(projectPath, preservedPath));
          this.forgetEditingProject(safeProjectId);
          this.clearLegacyAuxiliaryPolicy(safeProjectId);
          this.clearLegacyAdmissionForSource(safeProjectId);
          return { projectId: safeProjectId, path: preservedPath };
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
          if (!sourceExists && preservedExists) {
            this.clearLegacyAuxiliaryPolicy(safeProjectId);
            this.clearLegacyAdmissionForSource(safeProjectId);
            return { projectId: safeProjectId, path: preservedPath };
          }
          if (!sourceExists) {
            await releaseReservation();
            this.clearLegacyAuxiliaryPolicy(safeProjectId);
            this.clearLegacyAdmissionForSource(safeProjectId);
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
    return this.withLegacyRoutingOperation(() => this.deleteProjectUnlocked(projectId));
  }

  private async deleteProjectUnlocked(projectId: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeProjectId = projectPathSegment(projectId);
    if (!safeProjectId) return;
    const projectPath = await apis.join(appDataPath, 'projects', safeProjectId);

    // QNBS-v3: uncertain existence is a typed retryable deletion failure, never permission to clean up.
    const probeProjectExists = async (): Promise<boolean> => {
      try {
        return await apis.exists(projectPath);
      } catch (error) {
        logger.error('Failed to inspect project existence before deletion', {
          projectId: safeProjectId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ProjectDeleteError('identity-inspection-failed');
      }
    };
    // QNBS-v3 (#553): read-only hydration runs before locking so the project and every routed legacy directory it empties are locked in one sorted acquisition — the order fenced asset writes use — instead of logical-first, which could invert against them.
    if (await probeProjectExists()) {
      await this.hydrateLegacyPolicyForDeletion(safeProjectId, projectPath, apis, appDataPath);
    }
    const lockIds = [
      safeProjectId,
      this.legacyBinderProjectId(safeProjectId),
      this.legacyCodexProjectId(safeProjectId),
    ].filter((id): id is string => id !== null);
    await this.withProjectLocks(lockIds, async () =>
      this.removeProjectDataLocked(safeProjectId, projectPath, await probeProjectExists(), apis),
    );
    this.verifiedLegacyProjectDirectories.delete(safeProjectId);
    this.clearLegacyAdmissionForSource(safeProjectId);
    this.clearLegacyAuxiliaryPolicy(safeProjectId);
  }

  private async removeProjectDataLocked(
    safeProjectId: string,
    projectPath: string,
    projectExists: boolean,
    apis: TauriApis,
  ): Promise<void> {
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
      if (projectExists) await retryFs(() => apis.remove(projectPath, { recursive: true }));
      this.forgetEditingProject(safeProjectId);
    } catch (error) {
      logger.error('Failed to clean up legacy project data during deletion', {
        projectId: safeProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectDeleteError();
    }
  }

  private async hydrateLegacyPolicyForDeletion(
    safeProjectId: string,
    projectPath: string,
    apis: TauriApis,
    appDataPath: string,
  ): Promise<void> {
    if (
      this.legacyBinderAssetIdsForProject(safeProjectId).length > 0 ||
      this.legacyCodexProjectId(safeProjectId)
    ) {
      return;
    }
    let project: StoryProject;
    try {
      const projectFile = await apis.join(projectPath, 'project.json');
      if (!(await apis.exists(projectFile))) return;
      const parsed = decompressData<unknown>(await retryFs(() => apis.readTextFile(projectFile)));
      if (!looksLikeStoryProject(parsed)) throw new Error('Stored project is not project-shaped.');
      project = parsed;
    } catch (error) {
      logger.error('Could not inspect project identity before deletion', {
        projectId: safeProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectDeleteError('identity-inspection-failed');
    }
    try {
      await this.migrateLegacyProjectIdentity(project, safeProjectId, apis, appDataPath);
    } catch (error) {
      logger.error('Could not validate legacy auxiliary data before deletion', {
        projectId: safeProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ProjectDeleteError('identity-inspection-failed');
    }
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
          await this.saveImageUnfenced(row.id, row.avatarBase64);
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
          await this.saveImageUnfenced(row.id, row.ambianceImageBase64);
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
