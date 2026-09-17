/**
 * IDB canonical project admission + durable-commit boundary (#553, Phase D1).
 *
 * Establishes the "one authoritative persisted project generation" invariant for the IndexedDB
 * backend. The real fence compares the RAW (undecoded) stored `'project'` value -- captured at
 * admission time -- against a fresh read of that same key, synchronously inside the SAME
 * IndexedDB transaction as the write itself (mirroring encryptionMigrationJournal.ts's
 * saveIfCurrent pattern) -- never merely compared beforehand and then written by a later,
 * unrelated put(). Comparing raw bytes (not decrypted content) means the fence never needs to
 * decrypt inside that transaction, and it detects a concurrent write from ANY writer of that key,
 * including the legacy (non-fenced) saveSlice/saveProject path, not only one that participates in
 * this authority. WebCrypto encryption always completes BEFORE the transaction opens (mirrors
 * idbProjectStore.ts#saveSlice's existing discipline), since awaiting it mid-transaction would let
 * IndexedDB auto-commit the transaction first (TransactionInactiveError).
 *
 * A companion, unencrypted generation record is still written on every successful commit -- not as
 * the fencing mechanism, but as a durable "this project has been canonically committed at least
 * once" marker, used only to detect the contract's §2.7 downgrade contradiction.
 *
 * This is the IDB-specific backend adapter services/projectDocumentWriteback.ts's own module doc
 * anticipated: it re-reads the current raw carrier, calls commitOwnedProjectEdit, and persists the
 * result inside one atomic IDB operation. It is NOT yet wired into the production autosave path
 * (app/listenerMiddleware.ts) -- a later slice (#553 Phase D3) bridges the full-snapshot
 * ProjectData autosave input into an OwnedProjectEdit and routes it through
 * commitCanonicalProjectEdit. The existing (non-fenced) saveSlice/saveProject path is untouched by
 * this module and keeps working exactly as before.
 */

import {
  classifyRawProjectVersionFromParsed,
  type ProjectVersionClassification,
} from '../../features/project/projectSchemaVersion';
import { APP_DATA_STORE } from '../dbConstants';
import {
  type CanonicalProjectRawText,
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
  type OwnedProjectEdit,
  type ProjectSourceGeneration,
} from '../projectDocumentWriteback';
import { compressData, IdbConnectionManager } from './idbCore';
import { withProtectedWriteAdmission } from './protectedWriteAdmission';
import {
  assertNoActiveEncryptionMigration,
  idbEncryptWithKey,
  idbReadSecure,
  resolveProtectedWriteKey,
} from './storageEncryptionService';

const PROJECT_RECORD_KEY = 'project';
const GENERATION_RECORD_KEY = '__idb_project_canonical_generation_v1__';

interface ProjectGenerationRecord {
  generation: ProjectSourceGeneration;
  /** True once this project has ever reached a schema-aware CURRENT generation (contract §2.7). */
  migrated: boolean;
}

/** The original decoded envelope, minus its data/present.data payload -- sibling keys (e.g. past/future) survive a canonical commit unchanged. */
export interface ProjectEnvelopeShape {
  isPresentShape: boolean;
  originalEnvelope: Record<string, unknown>;
}

export type CanonicalProjectAdmission =
  | { status: 'ABSENT' }
  | {
      status: 'CURRENT';
      currentRaw: CanonicalProjectRawText;
      generation: ProjectSourceGeneration;
      envelope: ProjectEnvelopeShape;
    }
  | { status: 'NOT_ADMITTED'; classification: ProjectVersionClassification }
  // QNBS-v3 (#553 §2.7): the generation record proves a prior canonical generation existed, but the raw payload no longer classifies CURRENT -- a stale pre-contract copy superseded it and must never be treated as ordinary editable state.
  | { status: 'GENERATION_CONTRADICTION'; classification: ProjectVersionClassification };

export type CommitCanonicalProjectEditResult =
  | { status: 'COMMITTED'; generation: ProjectSourceGeneration }
  | { status: 'CONFLICT' }
  | { status: 'VERIFICATION_FAILED'; reason: string }
  | { status: 'MALFORMED_SOURCE'; reason: string }
  | { status: 'NOT_ADMITTED_FOR_WRITE'; classification: string };

interface StoredProjectEnvelope {
  data?: Record<string, unknown>;
  present?: { data: Record<string, unknown> };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapProjectEnvelope(
  raw: unknown,
): { payload: Record<string, unknown>; envelope: ProjectEnvelopeShape } | null {
  if (!isRecord(raw)) return null;
  const record = raw as StoredProjectEnvelope;
  if (isRecord(record.present) && isRecord(record.present.data)) {
    return {
      payload: record.present.data,
      envelope: { isPresentShape: true, originalEnvelope: raw },
    };
  }
  if (isRecord(record.data)) {
    return { payload: record.data, envelope: { isPresentShape: false, originalEnvelope: raw } };
  }
  return null;
}

/** Replaces only the nested data field; every other envelope member (e.g. redux-undo's past/future) survives untouched. */
function rewrapProjectEnvelope(
  payload: Record<string, unknown>,
  envelope: ProjectEnvelopeShape,
): StoredProjectEnvelope {
  const { originalEnvelope, isPresentShape } = envelope;
  if (!isPresentShape) return { ...originalEnvelope, data: payload };
  const originalPresent = isRecord(originalEnvelope['present']) ? originalEnvelope['present'] : {};
  return { ...originalEnvelope, present: { ...originalPresent, data: payload } };
}

function parseGenerationRecord(value: unknown): ProjectGenerationRecord | null {
  if (!isRecord(value)) return null;
  const { generation, migrated } = value;
  return typeof generation === 'string' && typeof migrated === 'boolean'
    ? { generation, migrated }
    : null;
}

function readKey(store: IDBObjectStore, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// QNBS-v3: compares the RAW (undecoded) stored representation for exact identity -- sufficient for the CAS fence without decrypting inside a transaction, where an await would let IndexedDB auto-commit it first.
function rawStoredValuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (isRecord(a) && isRecord(b)) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return a === b;
}

// QNBS-v3 (#553 §2.7): a migrated companion record combined with a non-CURRENT raw payload means a stale pre-contract-shaped write superseded it -- surfaced distinctly, never as ordinary non-admission.
function admitNonCurrentClassification(
  classification: ProjectVersionClassification,
  parsedGeneration: { migrated: boolean } | null,
): CanonicalProjectAdmission {
  return parsedGeneration?.migrated
    ? { status: 'GENERATION_CONTRADICTION', classification }
    : { status: 'NOT_ADMITTED', classification };
}

interface CanonicalProjectSnapshot {
  admission: CanonicalProjectAdmission;
  /** The exact raw (undecoded) value read from PROJECT_RECORD_KEY, for the raw-bytes CAS fence. */
  rawRecordSnapshot: unknown;
}

export class IdbProjectCanonicalAuthority extends IdbConnectionManager {
  /** Reads, decrypts/decompresses, and classifies the current canonical project record. Never writes anything. */
  async loadCanonicalProjectAdmission(): Promise<CanonicalProjectAdmission> {
    return (await this.readCanonicalProjectSnapshot()).admission;
  }

  private async readCanonicalProjectSnapshot(): Promise<CanonicalProjectSnapshot> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    const [rawRecord, generationRecordRaw] = await Promise.all([
      readKey(store, PROJECT_RECORD_KEY),
      readKey(store, GENERATION_RECORD_KEY),
    ]);
    if (rawRecord === undefined) {
      return { admission: { status: 'ABSENT' }, rawRecordSnapshot: rawRecord };
    }

    const decoded = await idbReadSecure<unknown>(rawRecord);
    const unwrapped = unwrapProjectEnvelope(decoded);
    const parsedGeneration = parseGenerationRecord(generationRecordRaw);
    if (!unwrapped) {
      return {
        admission: admitNonCurrentClassification('MALFORMED', parsedGeneration),
        rawRecordSnapshot: rawRecord,
      };
    }

    let currentRaw: string;
    try {
      currentRaw = JSON.stringify(unwrapped.payload);
    } catch {
      return {
        admission: admitNonCurrentClassification('MALFORMED', parsedGeneration),
        rawRecordSnapshot: rawRecord,
      };
    }
    const classification = classifyRawProjectVersionFromParsed(currentRaw, unwrapped.payload);
    if (classification !== 'CURRENT') {
      return {
        admission: admitNonCurrentClassification(classification, parsedGeneration),
        rawRecordSnapshot: rawRecord,
      };
    }

    const generation = computeProjectSourceGeneration(currentRaw);
    return {
      admission: { status: 'CURRENT', currentRaw, generation, envelope: unwrapped.envelope },
      rawRecordSnapshot: rawRecord,
    };
  }

  /**
   * Fences, overlays, verifies, and durably commits one writer's owned-path edit against the
   * canonical project record. `expectedGeneration` must come from a `loadCanonicalProjectAdmission`
   * call the caller made itself; the primitive re-reads the record fresh regardless, and the
   * actual atomicity fence compares raw stored bytes inside the write transaction, so a concurrent
   * write from ANY writer of PROJECT_RECORD_KEY -- another commitCanonicalProjectEdit caller, or
   * the legacy saveSlice/saveProject path -- fails closed (CONFLICT), never silently overwritten.
   */
  async commitCanonicalProjectEdit(params: {
    expectedGeneration: ProjectSourceGeneration;
    edit: OwnedProjectEdit;
  }): Promise<CommitCanonicalProjectEditResult> {
    const { admission, rawRecordSnapshot } = await this.readCanonicalProjectSnapshot();
    if (admission.status !== 'CURRENT') {
      const classification =
        admission.status === 'ABSENT'
          ? 'ABSENT'
          : admission.status === 'GENERATION_CONTRADICTION'
            ? `GENERATION_CONTRADICTION:${admission.classification}`
            : admission.classification;
      return { status: 'NOT_ADMITTED_FOR_WRITE', classification };
    }

    const applied = commitOwnedProjectEdit({
      expectedGeneration: params.expectedGeneration,
      currentRaw: admission.currentRaw,
      edit: params.edit,
    });
    if (applied.status !== 'COMMITTED') return applied;

    const newPayload = rewrapProjectEnvelope(
      JSON.parse(applied.raw) as Record<string, unknown>,
      admission.envelope,
    );
    return withProtectedWriteAdmission(async () => {
      // QNBS-v3: key resolution + encryption complete fully before the transaction opens -- an await here once the transaction is live would let IndexedDB auto-commit it first.
      const writeKey = await resolveProtectedWriteKey();
      const encodedPayload = writeKey
        ? await idbEncryptWithKey(writeKey, newPayload)
        : compressData(newPayload);
      await assertNoActiveEncryptionMigration();
      return this.commitGenerationFencedWrite(
        rawRecordSnapshot,
        applied.generation,
        encodedPayload,
      );
    });
  }

  // QNBS-v3: the real fence -- get PROJECT_RECORD_KEY, compare its raw bytes against the admission-time snapshot, and put both keys, synchronously inside one IDB transaction; detects a concurrent write from any writer, not only one that updates the companion generation record.
  private commitGenerationFencedWrite(
    expectedRawRecord: unknown,
    newGeneration: ProjectSourceGeneration,
    encodedPayload: unknown,
  ): Promise<CommitCanonicalProjectEditResult> {
    return this.getObjectStore(APP_DATA_STORE, 'readwrite').then(
      (store) =>
        new Promise<CommitCanonicalProjectEditResult>((resolve, reject) => {
          const transaction = store.transaction;
          let writeQueued = false;
          const projectRequest = store.get(PROJECT_RECORD_KEY);
          projectRequest.onerror = () => reject(projectRequest.error);
          projectRequest.onsuccess = () => {
            if (!rawStoredValuesEqual(projectRequest.result, expectedRawRecord)) {
              resolve({ status: 'CONFLICT' });
              return;
            }
            const nextGenerationRecord: ProjectGenerationRecord = {
              generation: newGeneration,
              migrated: true,
            };
            const putGenRequest = store.put(nextGenerationRecord, GENERATION_RECORD_KEY);
            const putProjectRequest = store.put(encodedPayload, PROJECT_RECORD_KEY);
            putGenRequest.onerror = () => reject(putGenRequest.error);
            putProjectRequest.onerror = () => reject(putProjectRequest.error);
            writeQueued = true;
          };
          transaction.oncomplete = () => {
            if (writeQueued) resolve({ status: 'COMMITTED', generation: newGeneration });
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('project canonical write transaction aborted'));
        }),
    );
  }
}

export const idbProjectCanonicalAuthority = new IdbProjectCanonicalAuthority();
