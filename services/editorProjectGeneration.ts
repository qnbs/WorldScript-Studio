/**
 * Editable-project replacement bookkeeping (#553 a10).
 *
 * `ProjectSliceState.generation` is the editor replacement epoch: it changes only when the editable
 * project is replaced wholesale (reset, import, snapshot restore, or an undo across one) — usually
 * keeping its id. It is unrelated to the backend's `ProjectSourceGeneration` CAS token and is typed
 * apart from it. The stored canonical text belongs to what the editor holds only when the last
 * durable save was of the same project, on the same storage authority, at the same epoch; the
 * baseline therefore carries that identity instead of being a bare integer, and is advanced only
 * after a save committed.
 */

import { getProjectTargetStorageId } from '../features/project/projectIdentity';

declare const editorEpochBrand: unique symbol;
export type EditorReplacementEpoch = number & { readonly [editorEpochBrand]: true };

export function toEditorReplacementEpoch(generation: number | undefined): EditorReplacementEpoch {
  return (generation ?? 0) as EditorReplacementEpoch;
}

interface PersistedBaseline {
  readonly targetStorageId: string;
  readonly authority: string;
  readonly epoch: EditorReplacementEpoch;
}

const BOOT_EPOCH = toEditorReplacementEpoch(0);
let editorEpoch: EditorReplacementEpoch = BOOT_EPOCH;
let baseline: PersistedBaseline | null = null;

interface RestoreCarrier {
  readonly targetStorageId: string;
  readonly epoch: EditorReplacementEpoch;
  readonly raw: string;
}

let restoreCarrier: RestoreCarrier | null = null;

/** Called by the project-change listener whenever `present.generation` changes. */
export function noteEditorEpoch(epoch: EditorReplacementEpoch): void {
  editorEpoch = epoch;
}

// QNBS-v3 (#553 a10): the target is the storage identity (id, or legacy directory) without the editor epoch, so a Safe-Session rekey that reassigns the id without bumping the epoch still breaks carrier reuse.
function targetStorageIdOf(project: unknown): string | null {
  return getProjectTargetStorageId({ data: project });
}

/** Called by persistence only after a save of `project` at `epoch` on `authority` committed. */
export function notePersistedEditorEpoch(
  project: unknown,
  authority: string,
  epoch: EditorReplacementEpoch,
): void {
  const targetStorageId = targetStorageIdOf(project);
  baseline = targetStorageId === null ? null : { targetStorageId, authority, epoch };
  // QNBS-v3 (#553 a5): only the save of the carrier's own target and epoch consumes it — an older save that finishes after a restore must not drop the restore's carrier.
  if (
    restoreCarrier !== null &&
    restoreCarrier.targetStorageId === targetStorageId &&
    restoreCarrier.epoch === epoch
  ) {
    restoreCarrier = null;
  }
}

/** Binds a restore's admitted text to the project and editor epoch the restore produced; called at the fulfilled boundary only. */
export function bindRestoreCarrier(
  project: unknown,
  epoch: EditorReplacementEpoch,
  raw: string,
): void {
  const targetStorageId = targetStorageIdOf(project);
  restoreCarrier = targetStorageId === null ? null : { targetStorageId, epoch, raw };
}

/**
 * The restored text the editor's `project` at `epoch` starts from, or null — a carrier bound to
 * another target or epoch (a later edit-replacing action, a switch, an undo across the restore) is
 * never reused.
 */
export function restoreCarrierFor(
  project: unknown,
  epoch: EditorReplacementEpoch = editorEpoch,
): string | null {
  if (!restoreCarrier || restoreCarrier.epoch !== epoch) return null;
  return restoreCarrier.targetStorageId === targetStorageIdOf(project) ? restoreCarrier.raw : null;
}

/** Drops the baseline when the storage authority changes under the editor (reset, rekey, re-init). */
export function invalidatePersistedEditorEpoch(): void {
  baseline = null;
  restoreCarrier = null;
}

/**
 * True unless the stored canonical text of `project`'s storage target on `authority` is known to belong to the
 * editor's `epoch`. Before any save, only the boot epoch (the project as loaded) counts as owned.
 */
export function isReplacementPending(
  project: unknown,
  authority: string,
  epoch: EditorReplacementEpoch = editorEpoch,
): boolean {
  const targetStorageId = targetStorageIdOf(project);
  if (targetStorageId === null) return true;
  if (!baseline) return epoch !== BOOT_EPOCH;
  return (
    baseline.targetStorageId !== targetStorageId ||
    baseline.authority !== authority ||
    baseline.epoch !== epoch
  );
}

export function _editorEpochForTest(): EditorReplacementEpoch {
  return editorEpoch;
}

export function _resetEditorProjectGenerationForTest(): void {
  editorEpoch = BOOT_EPOCH;
  baseline = null;
  restoreCarrier = null;
}
