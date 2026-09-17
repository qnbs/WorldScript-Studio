/**
 * IDB canonical project admission + durable-commit boundary (#553, Phase D1).
 *
 * Establishes the "one authoritative persisted project generation" invariant for the IndexedDB
 * backend: a companion, unencrypted generation record proves which raw-carrier generation the
 * `'project'` record currently holds. That comparison is checked and replaced inside the SAME
 * IndexedDB transaction as the project write itself (mirroring encryptionMigrationJournal.ts's
 * saveIfCurrent pattern) -- never merely compared beforehand and then written by a later,
 * unrelated put(). WebCrypto encryption always completes BEFORE that transaction opens (mirrors
 * idbProjectStore.ts#saveSlice's existing discipline), since awaiting it mid-transaction would let
 * IndexedDB auto-commit the transaction first (TransactionInactiveError).
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

/** True when the stored record used the `{present: {data}}` redux-undo shape, not the flat `{data}` shape. */
export interface ProjectEnvelopeShape {
  isPresentShape: boolean;
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
    return { payload: record.present.data, envelope: { isPresentShape: true } };
  }
  if (isRecord(record.data)) {
    return { payload: record.data, envelope: { isPresentShape: false } };
  }
  return null;
}

function rewrapProjectEnvelope(
  payload: Record<string, unknown>,
  envelope: ProjectEnvelopeShape,
): StoredProjectEnvelope {
  return envelope.isPresentShape ? { present: { data: payload } } : { data: payload };
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

// QNBS-v3 (#553 §2.7): a migrated companion record combined with a non-CURRENT raw payload means a stale pre-contract-shaped write superseded it -- surfaced distinctly, never as ordinary non-admission.
function admitNonCurrentClassification(
  classification: ProjectVersionClassification,
  parsedGeneration: { migrated: boolean } | null,
): CanonicalProjectAdmission {
  return parsedGeneration?.migrated
    ? { status: 'GENERATION_CONTRADICTION', classification }
    : { status: 'NOT_ADMITTED', classification };
}

export class IdbProjectCanonicalAuthority extends IdbConnectionManager {
  /**
   * Reads, decrypts/decompresses, and classifies the current canonical project record.
   * Bootstraps (or resyncs) the companion generation record whenever a CURRENT document's actual
   * content hash disagrees with it -- necessary while the legacy (non-fenced) saveSlice/saveProject
   * path can still write this project outside commitCanonicalProjectEdit's control (Phase D1/D2;
   * closed once Phase D3 makes this the sole writer).
   */
  async loadCanonicalProjectAdmission(): Promise<CanonicalProjectAdmission> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    const [rawRecord, generationRecordRaw] = await Promise.all([
      readKey(store, PROJECT_RECORD_KEY),
      readKey(store, GENERATION_RECORD_KEY),
    ]);
    if (rawRecord === undefined) return { status: 'ABSENT' };

    const decoded = await idbReadSecure<unknown>(rawRecord);
    const unwrapped = unwrapProjectEnvelope(decoded);
    const parsedGeneration = parseGenerationRecord(generationRecordRaw);
    if (!unwrapped) return admitNonCurrentClassification('MALFORMED', parsedGeneration);

    const currentRaw = JSON.stringify(unwrapped.payload);
    const classification = classifyRawProjectVersionFromParsed(currentRaw, unwrapped.payload);
    if (classification !== 'CURRENT') {
      return admitNonCurrentClassification(classification, parsedGeneration);
    }

    const generation = computeProjectSourceGeneration(currentRaw);
    if (!parsedGeneration || parsedGeneration.generation !== generation) {
      await this.writeGenerationRecordUnconditionally({ generation, migrated: true });
    }
    return { status: 'CURRENT', currentRaw, generation, envelope: unwrapped.envelope };
  }

  /**
   * Fences, overlays, verifies, and durably commits one writer's owned-path edit against the
   * canonical project record. `expectedGeneration` must come from a `loadCanonicalProjectAdmission`
   * call the caller made itself -- a concurrent newer write (same tab via the legacy path, or
   * another tab) between that read and this commit fails closed (CONFLICT), never silently
   * overwritten.
   */
  async commitCanonicalProjectEdit(params: {
    expectedGeneration: ProjectSourceGeneration;
    edit: OwnedProjectEdit;
  }): Promise<CommitCanonicalProjectEditResult> {
    const admission = await this.loadCanonicalProjectAdmission();
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
        params.expectedGeneration,
        applied.generation,
        encodedPayload,
      );
    });
  }

  private async writeGenerationRecordUnconditionally(
    record: ProjectGenerationRecord,
  ): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    const transaction = store.transaction;
    return new Promise((resolve, reject) => {
      const request = store.put(record, GENERATION_RECORD_KEY);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('project generation bootstrap transaction aborted'));
    });
  }

  // QNBS-v3: the real fence -- get, compare, and put both keys synchronously inside one IDB transaction, atomic with respect to every other writer, not merely a check before an unrelated later put().
  private commitGenerationFencedWrite(
    expectedGeneration: ProjectSourceGeneration,
    newGeneration: ProjectSourceGeneration,
    encodedPayload: unknown,
  ): Promise<CommitCanonicalProjectEditResult> {
    return this.getObjectStore(APP_DATA_STORE, 'readwrite').then(
      (store) =>
        new Promise<CommitCanonicalProjectEditResult>((resolve, reject) => {
          const transaction = store.transaction;
          let writeQueued = false;
          const genRequest = store.get(GENERATION_RECORD_KEY);
          genRequest.onerror = () => reject(genRequest.error);
          genRequest.onsuccess = () => {
            const current = parseGenerationRecord(genRequest.result);
            if (!current || current.generation !== expectedGeneration) {
              resolve({ status: 'CONFLICT' });
              return;
            }
            const nextRecord: ProjectGenerationRecord = {
              generation: newGeneration,
              migrated: true,
            };
            const putGenRequest = store.put(nextRecord, GENERATION_RECORD_KEY);
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
