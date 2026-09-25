import { CURRENT_PROJECT_SCHEMA_VERSION } from '../features/project/projectSchemaVersion';
import type { ProjectData } from '../features/project/projectState';
import type { StoryProject } from '../types';
import { buildAutosaveOwnedProjectEdit } from './projectAutosaveEditBridge';
import {
  type CanonicalProjectRawText,
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
  type ProjectSourceGeneration,
} from './projectDocumentWriteback';
import {
  type IdbProjectCanonicalAuthority,
  idbProjectCanonicalAuthority,
} from './storage/idbProjectCanonicalAuthority';

/**
 * Canonical IDB autosave lifecycle (#553 Phase D3, slice 2B) -- used by the web/PWA autosave
 * route through projectAutosavePersistence.ts; desktop autosave stays on its filesystem backend.
 *
 * Reconciles one full-snapshot autosave input with the canonical authority's real persisted
 * state, so that ordinary autosave never depends on the record already being a CURRENT canonical
 * document:
 *
 * - ABSENT (first-ever save) -> synthesize a validated CURRENT payload from the snapshot and
 *   atomically create the canonical record (browser `{ data: ... }` envelope) -- never bootstrap
 *   through the legacy saveSlice path, which would persist a schemaVersion-less LEGACY_UNVERSIONED
 *   record in a schema-aware build.
 * - LEGACY_UNVERSIONED -> the authority's durable §2.4 migration, then ONE reload and the
 *   ordinary owned-edit commit in the SAME call -- the migration persisted the previously stored
 *   legacy state, while the current Redux snapshot may carry new user edits that a future debounce
 *   might never come to save.
 * - CURRENT -> the #777 bridge edit through commitCanonicalProjectEdit, or, for a replaced editor
 *   project, a whole-document commitCanonicalProjectReplacement.
 * - FUTURE / SUPPORTED_OLDER / UNSUPPORTED_OLDER / MALFORMED / GENERATION_CONTRADICTION -> fail
 *   closed with a typed refusal; there is deliberately NO fallback to storageService.saveProject.
 *
 * Concurrency budget: the whole invocation gets at most ONE fresh re-evaluation (after a
 * create CONFLICT, a successful migration, or a benign concurrent CURRENT progression). A state
 * whose handling would require another reload stops as a typed CONFLICT/refusal; the next
 * ordinary debounce cycle re-evaluates naturally. CONFLICT, VERIFICATION_FAILED, and
 * MALFORMED_SOURCE keep their distinct semantics -- only Slice 2B's listener wiring may map them
 * onto one user-facing autosave-failure notification.
 */

export type CanonicalAutosaveRefusal =
  | 'MALFORMED'
  | 'FUTURE'
  | 'SUPPORTED_OLDER'
  | 'UNSUPPORTED_OLDER'
  | 'GENERATION_CONTRADICTION';

export type CanonicalAutosaveResult =
  | { status: 'SAVED'; generation: ProjectSourceGeneration }
  | { status: 'CREATED'; generation: ProjectSourceGeneration }
  | { status: 'MIGRATED_AND_SAVED'; generation: ProjectSourceGeneration }
  | { status: 'REFUSED'; reason: CanonicalAutosaveRefusal }
  | { status: 'CONFLICT' }
  | { status: 'VERIFICATION_FAILED'; reason: string }
  | { status: 'MALFORMED_SOURCE'; reason: string };

/**
 * Converts every non-committing authority result into a rejected persistence operation.
 */
export function assertCanonicalAutosaveSucceeded(result: CanonicalAutosaveResult): void {
  switch (result.status) {
    case 'SAVED':
    case 'CREATED':
    case 'MIGRATED_AND_SAVED':
      return;
    default:
      // QNBS-v3: a refusal must reject the coordinator operation so indexing, analytics, and the UI success state cannot claim durability after canonical admission failed.
      throw new Error(`Canonical autosave did not commit (${result.status})`);
  }
}

type Evaluation =
  | { outcome: 'FINAL'; result: CanonicalAutosaveResult }
  | { outcome: 'REEVALUATE'; afterMigration?: true };

const final = (result: CanonicalAutosaveResult): Evaluation => ({ outcome: 'FINAL', result });
const reevaluate = (afterMigration?: true): Evaluation =>
  afterMigration ? { outcome: 'REEVALUATE', afterMigration: true } : { outcome: 'REEVALUATE' };

function refusalForClassification(classification: string): CanonicalAutosaveRefusal | null {
  switch (classification) {
    case 'MALFORMED':
      return 'MALFORMED';
    case 'FUTURE':
      return 'FUTURE';
    case 'SUPPORTED_OLDER':
      return 'SUPPORTED_OLDER';
    case 'UNSUPPORTED_OLDER':
      return 'UNSUPPORTED_OLDER';
    default:
      return null;
  }
}

function resultForNonAdmittedClassification(classification: string): CanonicalAutosaveResult {
  if (classification.startsWith('GENERATION_CONTRADICTION')) {
    return { status: 'REFUSED', reason: 'GENERATION_CONTRADICTION' };
  }
  const refusal = refusalForClassification(classification);
  return refusal === null ? { status: 'CONFLICT' } : { status: 'REFUSED', reason: refusal };
}

// QNBS-v3: the runtime-extra schemaVersion is discarded and the authority-owned CURRENT version injected last, so spread ordering or snapshot extras can never override it.
export function buildInitialCanonicalRaw(
  snapshot: ProjectData | StoryProject,
): CanonicalProjectRawText {
  const snapshotRecord = snapshot as unknown as Record<string, unknown>;
  const { characters, worlds, schemaVersion: _runtimeExtra, ...rest } = snapshotRecord;
  return JSON.stringify({
    ...rest,
    characters,
    worlds,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  });
}

async function commitSnapshotEdit(
  snapshot: ProjectData,
  authority: IdbProjectCanonicalAuthority,
  currentRaw: CanonicalProjectRawText,
  expectedGeneration: ProjectSourceGeneration,
): Promise<CanonicalAutosaveResult> {
  const edit = buildAutosaveOwnedProjectEdit(snapshot, currentRaw);
  const result = await authority.commitCanonicalProjectEdit({ expectedGeneration, edit });
  if (result.status === 'COMMITTED') return { status: 'SAVED', generation: result.generation };
  if (result.status === 'NOT_ADMITTED_FOR_WRITE') {
    // QNBS-v3: CURRENT is not a refusal the edit-commit path can meaningfully classify without another reload, which this evaluation has no budget for -- stop as CONFLICT and let the next debounce re-evaluate.
    return resultForNonAdmittedClassification(result.classification);
  }
  return result;
}

export interface CanonicalAutosaveOptions {
  /** The editor project replaced the stored one; write it whole instead of overlaying it (#553 a10). */
  replacement?: boolean;
  /** A restored project's admitted text: the replacement overlays the editor's edits onto it (#553 a5). */
  replacementRaw?: string;
}

// QNBS-v3 (#553 a5): a restored project keeps the snapshot's own text — its opaque fields and exact tokens — with only the editor's owned changes applied; a carrier that cannot take the edit fails closed instead of silently falling back to a fresh document.
function replacementDocument(
  snapshot: ProjectData,
  options: CanonicalAutosaveOptions,
):
  | { status: 'OK'; raw: CanonicalProjectRawText }
  | { status: 'VERIFICATION_FAILED'; reason: string } {
  const carrier = options.replacementRaw;
  if (carrier === undefined) return { status: 'OK', raw: buildInitialCanonicalRaw(snapshot) };
  let status: string;
  try {
    const applied = commitOwnedProjectEdit({
      expectedGeneration: computeProjectSourceGeneration(carrier),
      currentRaw: carrier,
      edit: buildAutosaveOwnedProjectEdit(snapshot, carrier),
    });
    if (applied.status === 'COMMITTED') return { status: 'OK', raw: applied.raw };
    status = applied.status;
  } catch {
    status = 'MALFORMED_CARRIER';
  }
  return {
    status: 'VERIFICATION_FAILED',
    reason: `restore carrier did not accept the editor edit (${status})`,
  };
}

// QNBS-v3 (#553 a10): one dispatch point for both CURRENT write paths, so the post-migration commit cannot silently fall back to an overlay of the predecessor's text.
async function commitSnapshot(
  snapshot: ProjectData,
  authority: IdbProjectCanonicalAuthority,
  currentRaw: CanonicalProjectRawText,
  expectedGeneration: ProjectSourceGeneration,
  options: CanonicalAutosaveOptions,
): Promise<CanonicalAutosaveResult> {
  if (!options.replacement) {
    return commitSnapshotEdit(snapshot, authority, currentRaw, expectedGeneration);
  }
  const document = replacementDocument(snapshot, options);
  if (document.status !== 'OK') return document;
  const result = await authority.commitCanonicalProjectReplacement({
    expectedGeneration,
    currentRaw: document.raw,
  });
  if (result.status === 'COMMITTED') return { status: 'SAVED', generation: result.generation };
  if (result.status === 'NOT_ADMITTED_FOR_WRITE') {
    return resultForNonAdmittedClassification(result.classification);
  }
  return result;
}

async function handleLegacyUnversioned(
  authority: IdbProjectCanonicalAuthority,
): Promise<Evaluation> {
  const migrated = await authority.commitLegacyToV1Migration();
  if (migrated.status === 'COMMITTED') return reevaluate(true);
  if (migrated.status === 'CONFLICT') return final({ status: 'CONFLICT' });
  if (migrated.status === 'NOT_ELIGIBLE') {
    // QNBS-v3: NOT_ELIGIBLE:CURRENT is benign concurrent progression (another actor advanced the source between our admission and the migration attempt) -- the single budgeted re-evaluation reconciles it, rather than misclassifying it as a permanent refusal.
    if (migrated.classification === 'CURRENT') return reevaluate();
    return final(resultForNonAdmittedClassification(migrated.classification));
  }
  return final(migrated);
}

// QNBS-v3: migration's sole fresh re-evaluation must admit CURRENT before editing; no create/migrate branch may consume a second reload.
async function finishAfterMigration(
  snapshot: ProjectData,
  authority: IdbProjectCanonicalAuthority,
  options: CanonicalAutosaveOptions,
): Promise<CanonicalAutosaveResult> {
  const admission = await authority.loadCanonicalProjectAdmission();
  if (admission.status !== 'CURRENT') {
    if (admission.status === 'ABSENT') return { status: 'CONFLICT' };
    if (admission.status === 'GENERATION_CONTRADICTION') {
      return { status: 'REFUSED', reason: 'GENERATION_CONTRADICTION' };
    }
    return resultForNonAdmittedClassification(admission.classification);
  }

  const saved = await commitSnapshot(
    snapshot,
    authority,
    admission.currentRaw,
    admission.generation,
    options,
  );
  return saved.status === 'SAVED'
    ? { status: 'MIGRATED_AND_SAVED', generation: saved.generation }
    : saved;
}

async function evaluateOnce(
  snapshot: ProjectData,
  authority: IdbProjectCanonicalAuthority,
  options: CanonicalAutosaveOptions,
): Promise<Evaluation> {
  const admission = await authority.loadCanonicalProjectAdmission();
  switch (admission.status) {
    case 'ABSENT': {
      const created = await authority.createCanonicalProjectIfAbsent({
        currentRaw: buildInitialCanonicalRaw(snapshot),
      });
      if (created.status === 'CREATED') {
        return final({ status: 'CREATED', generation: created.generation });
      }
      if (created.status === 'CONFLICT') return reevaluate();
      return final(created);
    }
    case 'CURRENT':
      return final(
        await commitSnapshot(
          snapshot,
          authority,
          admission.currentRaw,
          admission.generation,
          options,
        ),
      );
    case 'NOT_ADMITTED':
      if (admission.classification === 'LEGACY_UNVERSIONED') {
        return await handleLegacyUnversioned(authority);
      }
      return final(resultForNonAdmittedClassification(admission.classification));
    case 'GENERATION_CONTRADICTION':
      return final({ status: 'REFUSED', reason: 'GENERATION_CONTRADICTION' });
  }
}

export async function saveAutosaveSnapshotCanonical(
  snapshot: ProjectData,
  authority: IdbProjectCanonicalAuthority = idbProjectCanonicalAuthority,
  options: CanonicalAutosaveOptions = {},
): Promise<CanonicalAutosaveResult> {
  const first = await evaluateOnce(snapshot, authority, options);
  if (first.outcome === 'FINAL') return first.result;
  if (first.afterMigration === true) return finishAfterMigration(snapshot, authority, options);
  // QNBS-v3: exactly one re-evaluation per invocation -- a second-pass state that would need yet another reload stops as CONFLICT; the next ordinary debounce cycle retries naturally.
  const second = await evaluateOnce(snapshot, authority, options);
  if (second.outcome !== 'FINAL') return { status: 'CONFLICT' };
  return second.result;
}
