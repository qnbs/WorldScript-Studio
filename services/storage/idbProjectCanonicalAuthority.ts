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
 *
 * commitLegacyToV1Migration (#553 Phase D2) durably commits the contract's §2.4 LEGACY_TO_V1 step
 * (recognize -> verify against PROJECT_SCHEMA_V1's field set -> stamp schemaVersion -> revalidate)
 * through this SAME atomic boundary -- commitGenerationFencedWrite -- rather than a second,
 * independent write protocol. It reuses services/projectDocument.ts's existing, already-admitted
 * admitCanonicalProjectDocument for steps 1-2 and 3-4 (a pure byte-splice overlay that touches no
 * other byte, so no-loss is structural, not a separate verification pass); this module owns only
 * the durable-commit boundary, not the migration logic itself.
 */

import {
  classifyRawProjectVersionFromParsed,
  type ProjectVersionClassification,
} from '../../features/project/projectSchemaVersion';
import { APP_DATA_STORE } from '../dbConstants';
import { admitCanonicalProjectDocument } from '../projectDocument';
import {
  type CanonicalProjectRawText,
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
  type OwnedProjectEdit,
  type ProjectSourceGeneration,
} from '../projectDocumentWriteback';
import { importedProjectJsonSchema } from '../projectImportSchema';
import { compressData, decompressData, IdbConnectionManager } from './idbCore';
import { withProtectedWriteAdmission } from './protectedWriteAdmission';
import {
  assertNoActiveEncryptionMigration,
  idbDecryptWithKey,
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

/**
 * The original decoded envelope, minus its payload -- sibling keys (e.g. redux-undo's past/future)
 * survive a canonical commit unchanged. 'flat' is a self-describing record with no wrapper at all
 * (idbProjectStore.ts#selectIdbProjectObservationTarget's own precedent: a record with its own
 * schemaVersion is classified directly, never misread as a Redux envelope via an unrelated
 * data/present field) -- commitOwnedProjectEdit's real production input via saveProject(StoryProject).
 */
export type ProjectEnvelopeShape =
  | { kind: 'flat' }
  | { kind: 'data'; originalEnvelope: Record<string, unknown> }
  | { kind: 'present'; originalEnvelope: Record<string, unknown> };

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

export type CommitLegacyToV1MigrationResult =
  | CommitCanonicalProjectEditResult
  // QNBS-v3: distinct from NOT_ADMITTED_FOR_WRITE -- this path exists specifically for LEGACY_UNVERSIONED sources, so an already-CURRENT (or FUTURE/MALFORMED) document is "not eligible for migration", not "refused write authority".
  | { status: 'NOT_ELIGIBLE'; classification: string };

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
  // QNBS-v3: mirrors idbProjectStore.ts#selectIdbProjectObservationTarget's own precedent -- checked first so a flat record that also happens to carry an unrelated data/present field is never misread via that field instead of its own header.
  if (Object.hasOwn(record, 'schemaVersion')) {
    return { payload: raw as Record<string, unknown>, envelope: { kind: 'flat' } };
  }
  if (isRecord(record.present) && isRecord(record.present.data)) {
    return {
      payload: record.present.data,
      envelope: { kind: 'present', originalEnvelope: raw },
    };
  }
  if (isRecord(record.data)) {
    return { payload: record.data, envelope: { kind: 'data', originalEnvelope: raw } };
  }
  // QNBS-v3: a pre-v1 flat record necessarily lacks schemaVersion, so it can't hit the check above -- without this, every genuinely flat legacy project would be classified MALFORMED and never eligible for migration. classifyRawProjectVersionFromParsed/importedProjectJsonSchema still validate real shape downstream; this only decides which bytes are the payload.
  return { payload: raw, envelope: { kind: 'flat' } };
}

/** Replaces only the nested payload; every other envelope member (e.g. redux-undo's past/future) survives untouched. A 'flat' record stays flat -- never gains a data/present wrapper it never had. */
function rewrapProjectEnvelope(
  payload: Record<string, unknown>,
  envelope: ProjectEnvelopeShape,
): StoredProjectEnvelope | Record<string, unknown> {
  if (envelope.kind === 'flat') return payload;
  if (envelope.kind === 'data') return { ...envelope.originalEnvelope, data: payload };
  const originalPresent = isRecord(envelope.originalEnvelope['present'])
    ? envelope.originalEnvelope['present']
    : {};
  return { ...envelope.originalEnvelope, present: { ...originalPresent, data: payload } };
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

// QNBS-v3: tracks object pairs already being compared up the recursion, so a cyclic structured-clone value (compressData falls back to the original object, cycle intact, when JSON.stringify on it throws) terminates instead of overflowing the stack.
type SeenPairs = WeakMap<object, WeakSet<object>>;

function alreadyComparing(seen: SeenPairs, a: object, b: object): boolean {
  const existing = seen.get(a);
  if (existing?.has(b)) return true;
  if (existing) existing.add(b);
  else seen.set(a, new WeakSet([b]));
  return false;
}

/** True only for a genuine plain object/dictionary -- excludes Date, RegExp, Map, Set, and other exotic built-ins, so a mixed pair of two DIFFERENT such types (which no type-specific handler below claims) is never mistaken for two empty plain objects. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

// QNBS-v3: covers every typed-array/DataView kind, not just Uint8Array -- an unrecognized exotic type otherwise always compares unequal, so an unchanged envelope sibling holding one would spuriously CONFLICT on every commit.
function typedArrayViewsEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.constructor !== b.constructor) return false;
  return bytesEqual(
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
    new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );
}

// QNBS-v3: Map/Set iteration order is preserved by both native insertion order and structured clone, so an ordered array comparison correctly handles object-typed keys/values -- `.has()` would use reference equality and miss a structurally-identical-but-different-instance match.
function mapsEqual(
  a: ReadonlyMap<unknown, unknown>,
  b: ReadonlyMap<unknown, unknown>,
  seen: SeenPairs,
): boolean {
  return arraysEqual([...a], [...b], seen);
}

function setsEqual(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>, seen: SeenPairs): boolean {
  return arraysEqual([...a], [...b], seen);
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[], seen: SeenPairs): boolean {
  return (
    a.length === b.length && a.every((value, index) => deepStructuredEqual(value, b[index], seen))
  );
}

function recordsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  seen: SeenPairs,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(b, key) && deepStructuredEqual(a[key], b[key], seen))
  );
}

type StructuredEqualityHandler = {
  test: (a: unknown, b: unknown) => boolean;
  equal: (a: unknown, b: unknown, seen: SeenPairs) => boolean;
};

// QNBS-v3: a data-driven dispatch table keeps this a single lookup instead of a branch per structured-clone value kind.
const STRUCTURED_EQUALITY_HANDLERS: readonly StructuredEqualityHandler[] = [
  {
    test: (a, b) => a instanceof Date && b instanceof Date,
    equal: (a, b) => (a as Date).getTime() === (b as Date).getTime(),
  },
  {
    test: (a, b) => a instanceof RegExp && b instanceof RegExp,
    equal: (a, b) =>
      (a as RegExp).source === (b as RegExp).source && (a as RegExp).flags === (b as RegExp).flags,
  },
  {
    test: (a, b) => ArrayBuffer.isView(a) && ArrayBuffer.isView(b),
    equal: (a, b) => typedArrayViewsEqual(a as ArrayBufferView, b as ArrayBufferView),
  },
  // QNBS-v3: a bare ArrayBuffer (not a view) is a distinct type ArrayBuffer.isView() never matches -- without this it always fell through to the "unequal" default, so an unchanged sibling holding one would spuriously CONFLICT on every commit.
  {
    test: (a, b) => a instanceof ArrayBuffer && b instanceof ArrayBuffer,
    equal: (a, b) => bytesEqual(new Uint8Array(a as ArrayBuffer), new Uint8Array(b as ArrayBuffer)),
  },
  {
    test: (a, b) => a instanceof Map && b instanceof Map,
    equal: (a, b, seen) => mapsEqual(a as Map<unknown, unknown>, b as Map<unknown, unknown>, seen),
  },
  {
    test: (a, b) => a instanceof Set && b instanceof Set,
    equal: (a, b, seen) => setsEqual(a as Set<unknown>, b as Set<unknown>, seen),
  },
  {
    test: (a, b) => Array.isArray(a) && Array.isArray(b),
    equal: (a, b, seen) => arraysEqual(a as unknown[], b as unknown[], seen),
  },
  {
    test: (a, b) => isPlainObject(a) && isPlainObject(b),
    equal: (a, b, seen) =>
      recordsEqual(a as Record<string, unknown>, b as Record<string, unknown>, seen),
  },
];

// QNBS-v3 (#553): a type-aware structural comparison -- JSON.stringify silently equates structurally-different Map/Set/Date/RegExp values (and drops undefined-valued properties), which would let the CAS fence miss a genuine concurrent change.
function deepStructuredEqual(a: unknown, b: unknown, seen: SeenPairs = new WeakMap()): boolean {
  // QNBS-v3: Object.is, not === -- JSON.stringify(-0) emits "0", so a === b would wrongly accept that silent -0-to-0 change as a lossless round-trip.
  if (Object.is(a, b)) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    if (alreadyComparing(seen, a, b)) return true;
  }
  const handler = STRUCTURED_EQUALITY_HANDLERS.find((candidate) => candidate.test(a, b));
  return handler ? handler.equal(a, b, seen) : false;
}

// QNBS-v3: compares the RAW (undecoded) stored representation for exact identity -- sufficient for the CAS fence without decrypting inside a transaction, where an await would let IndexedDB auto-commit it first.
function rawStoredValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return deepStructuredEqual(a, b);
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

interface DecodedProjectSnapshot {
  /** The exact raw (undecoded) value read from PROJECT_RECORD_KEY, for the raw-bytes CAS fence. */
  rawRecordSnapshot: unknown;
  parsedGeneration: ProjectGenerationRecord | null;
  /** Null when the record is absent, not a recognized envelope, or its payload cannot be JSON-stringified. */
  decoded: {
    payload: Record<string, unknown>;
    envelope: ProjectEnvelopeShape;
    currentRaw: string;
  } | null;
}

export class IdbProjectCanonicalAuthority extends IdbConnectionManager {
  /** Reads, decrypts/decompresses, and classifies the current canonical project record. Never writes anything. */
  async loadCanonicalProjectAdmission(): Promise<CanonicalProjectAdmission> {
    return (await this.readCanonicalProjectSnapshot()).admission;
  }

  private async readDecodedProjectSnapshot(): Promise<DecodedProjectSnapshot> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readonly');
    const [rawRecord, generationRecordRaw] = await Promise.all([
      readKey(store, PROJECT_RECORD_KEY),
      readKey(store, GENERATION_RECORD_KEY),
    ]);
    const parsedGeneration = parseGenerationRecord(generationRecordRaw);
    if (rawRecord === undefined)
      return { rawRecordSnapshot: rawRecord, parsedGeneration, decoded: null };

    const decodedValue = await idbReadSecure<unknown>(rawRecord);
    const unwrapped = unwrapProjectEnvelope(decodedValue);
    if (!unwrapped) return { rawRecordSnapshot: rawRecord, parsedGeneration, decoded: null };

    try {
      const currentRaw = JSON.stringify(unwrapped.payload);
      // QNBS-v3: JSON.stringify silently blanks a Map/Set/RegExp field to `{}` and drops undefined-valued keys instead of throwing -- round-trip and structurally compare so a payload this text representation can't faithfully carry is classified MALFORMED, the same outcome a cyclic value inside `data` already gets from the throw above, instead of being silently truncated on the next commit.
      const roundTripped = JSON.parse(currentRaw) as Record<string, unknown>;
      if (!deepStructuredEqual(roundTripped, unwrapped.payload)) {
        return { rawRecordSnapshot: rawRecord, parsedGeneration, decoded: null };
      }
      return {
        rawRecordSnapshot: rawRecord,
        parsedGeneration,
        decoded: { payload: unwrapped.payload, envelope: unwrapped.envelope, currentRaw },
      };
    } catch {
      return { rawRecordSnapshot: rawRecord, parsedGeneration, decoded: null };
    }
  }

  private async readCanonicalProjectSnapshot(): Promise<CanonicalProjectSnapshot> {
    const { rawRecordSnapshot, parsedGeneration, decoded } =
      await this.readDecodedProjectSnapshot();
    if (rawRecordSnapshot === undefined) {
      return { admission: { status: 'ABSENT' }, rawRecordSnapshot };
    }
    if (!decoded) {
      return {
        admission: admitNonCurrentClassification('MALFORMED', parsedGeneration),
        rawRecordSnapshot,
      };
    }

    const classification = classifyRawProjectVersionFromParsed(decoded.currentRaw, decoded.payload);
    if (classification !== 'CURRENT') {
      return {
        admission: admitNonCurrentClassification(classification, parsedGeneration),
        rawRecordSnapshot,
      };
    }

    const generation = computeProjectSourceGeneration(decoded.currentRaw);
    return {
      admission: {
        status: 'CURRENT',
        currentRaw: decoded.currentRaw,
        generation,
        envelope: decoded.envelope,
      },
      rawRecordSnapshot,
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
      const encoded = await this.encodeVerifiedPayload(newPayload);
      if (encoded.status === 'VERIFICATION_FAILED') return encoded;
      return this.commitGenerationFencedWrite(
        rawRecordSnapshot,
        applied.generation,
        encoded.encodedPayload,
      );
    });
  }

  /**
   * Encrypts/compresses newPayload, then decodes it back and verifies it round-trips losslessly
   * before ever attempting a commit -- compressData JSON-serializes payloads at or above its
   * threshold (dropping undefined-valued keys and converting unsupported structured-clone values
   * like Map/Set instead of throwing), so an envelope sibling holding such a value could otherwise
   * be silently corrupted on write. Fully resolved before the write transaction opens, so this
   * extra async decode is safe here (unlike inside commitGenerationFencedWrite's transaction).
   */
  private async encodeVerifiedPayload(
    newPayload: StoredProjectEnvelope | Record<string, unknown>,
  ): Promise<
    { status: 'OK'; encodedPayload: unknown } | { status: 'VERIFICATION_FAILED'; reason: string }
  > {
    // QNBS-v3: key resolution + encryption complete fully before the transaction opens -- an await here once the transaction is live would let IndexedDB auto-commit it first.
    const writeKey = await resolveProtectedWriteKey();
    const encodedPayload = writeKey
      ? await idbEncryptWithKey(writeKey, newPayload)
      : compressData(newPayload);
    await assertNoActiveEncryptionMigration();
    const decoded = writeKey
      ? await idbDecryptWithKey<unknown>(writeKey, encodedPayload as Uint8Array)
      : decompressData<unknown>(encodedPayload);
    if (!deepStructuredEqual(decoded, newPayload)) {
      return {
        status: 'VERIFICATION_FAILED',
        reason: 'Encoded payload does not round-trip losslessly before commit.',
      };
    }
    return { status: 'OK', encodedPayload };
  }

  /**
   * Durably commits the contract's §2.4 LEGACY_TO_V1 step for a LEGACY_UNVERSIONED project record,
   * through the SAME atomic raw-bytes fence commitCanonicalProjectEdit uses -- not a second,
   * independent write protocol. Refuses (NOT_ELIGIBLE) any record that is not exactly
   * LEGACY_UNVERSIONED and does not conform to PROJECT_SCHEMA_V1's field set, or a CURRENT record
   * (already migrated -- see commitCanonicalProjectEdit instead), FUTURE, or MALFORMED. Also refuses
   * (as a §2.7 GENERATION_CONTRADICTION, not an ordinary migration) a LEGACY_UNVERSIONED record when
   * the companion generation record says this project was already canonically committed once --
   * migrating and durably committing it would let a stale pre-contract-shaped write silently
   * supersede the already-migrated canonical generation.
   */
  async commitLegacyToV1Migration(): Promise<CommitLegacyToV1MigrationResult> {
    const { rawRecordSnapshot, parsedGeneration, decoded } =
      await this.readDecodedProjectSnapshot();
    if (rawRecordSnapshot === undefined)
      return { status: 'NOT_ELIGIBLE', classification: 'ABSENT' };
    if (!decoded) return { status: 'NOT_ELIGIBLE', classification: 'MALFORMED' };

    const classification = classifyRawProjectVersionFromParsed(decoded.currentRaw, decoded.payload);
    if (classification !== 'LEGACY_UNVERSIONED') {
      return { status: 'NOT_ELIGIBLE', classification };
    }
    if (parsedGeneration?.migrated) {
      return {
        status: 'NOT_ELIGIBLE',
        classification: `GENERATION_CONTRADICTION:${classification}`,
      };
    }

    // QNBS-v3: recognize + verify against PROJECT_SCHEMA_V1 + stamp + revalidate (contract §2.4, steps 1-4) -- a pure byte-splice overlay, so no-loss is structural, not a separate check.
    const admission = admitCanonicalProjectDocument(decoded.currentRaw, importedProjectJsonSchema);
    if (admission.status !== 'LEGACY_TO_V1' || admission.canonical === null) {
      return { status: 'NOT_ELIGIBLE', classification: admission.source.classification };
    }

    const migratedRaw = admission.canonical.raw;
    const newPayload = rewrapProjectEnvelope(
      JSON.parse(migratedRaw) as Record<string, unknown>,
      decoded.envelope,
    );
    const newGeneration = computeProjectSourceGeneration(migratedRaw);

    return withProtectedWriteAdmission(async () => {
      const encoded = await this.encodeVerifiedPayload(newPayload);
      if (encoded.status === 'VERIFICATION_FAILED') return encoded;
      return this.commitGenerationFencedWrite(
        rawRecordSnapshot,
        newGeneration,
        encoded.encodedPayload,
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

  /**
   * Clears the companion §2.7 marker before a deliberate whole-project replacement (Factory Reset,
   * importing an unrelated project) -- otherwise a genuinely new, unrelated legacy project would be
   * permanently misclassified as a stale downgrade of whatever was migrated before it. This
   * authority has no reliable way to distinguish "a new project" from "a stale copy of the same
   * one" on its own: ProjectData's `id` field cannot help, since every fresh project reuses
   * id:'default' until explicitly saved elsewhere.
   *
   * NOT internally race-safe against a concurrent commit: this runs as its own transaction, not
   * fenced against PROJECT_RECORD_KEY, and `withProtectedWriteAdmission`'s lock is 'shared' mode --
   * it excludes only an in-progress encryption migration, not another ordinary writer, so it cannot
   * serialize this against a concurrent commitCanonicalProjectEdit/commitLegacyToV1Migration either.
   * The caller (#553 Phase D3's reset/replace flow) MUST ensure no concurrent commit can land
   * between deciding to replace the project and calling this -- e.g. by suspending autosave for the
   * duration, the same way a whole-project replacement already must for the legacy saveSlice path.
   */
  async clearCanonicalGenerationMarker(): Promise<void> {
    const store = await this.getObjectStore(APP_DATA_STORE, 'readwrite');
    return new Promise<void>((resolve, reject) => {
      const request = store.delete(GENERATION_RECORD_KEY);
      const transaction = store.transaction;
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('clear generation marker transaction aborted'));
    });
  }
}

export const idbProjectCanonicalAuthority = new IdbProjectCanonicalAuthority();
