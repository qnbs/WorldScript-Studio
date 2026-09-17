import type { EntityState } from '@reduxjs/toolkit';
import {
  type CoreCollection,
  coreArrayToEntityState,
  entityStateToCoreArray,
} from '../features/project/coreBoundaryAdapter';
import { classifyRawProjectVersion } from '../features/project/projectSchemaVersion';
import {
  type CanonicalRawObjectMember,
  readTopLevelObjectMembers,
  skipRawJsonString,
  skipRawJsonValue,
  skipRawJsonWhitespace,
} from './projectDocument';

/**
 * Durable source-generation fence + canonical writeback overlay foundation (#553).
 *
 * This module is a standalone, backend-neutral correctness primitive. It is deliberately NOT wired
 * into any production writer (IDB, filesystem, or otherwise) yet -- TypeScript's existing save paths
 * are unchanged by this file. A later, separate #553 slice integrates a specific backend's atomic
 * commit (an IndexedDB transaction, a filesystem compare-and-swap primitive, etc.) by re-reading the
 * current on-disk/on-storage raw text, calling `commitOwnedProjectEdit`, and only persisting the
 * result inside that same atomic operation.
 *
 * Implements the contract's §3.2 write-back invariant: raw source R -> a writer's owned-path edit is
 * overlaid onto a copy of R (never a full re-serialization of a typed projection) -> the merge is
 * verified two-sided (unowned paths byte-identical, owned paths match intent exactly) -> the source
 * generation is atomically re-checked at commit time; a concurrent newer write fails closed rather
 * than being silently overwritten.
 */

/** The full canonical project document, as JSON text (never a parsed/typed value). */
export type CanonicalProjectRawText = string;

/** An opaque compare-and-swap token identifying one exact raw-text state (contract §3.2). */
export type ProjectSourceGeneration = string;

export type EntityLike = { id: string; [key: string]: unknown };

export interface EntityCollectionEdit<T extends EntityLike = EntityLike> {
  /** Entities to insert or replace, by id. */
  upsert?: readonly T[];
  /** Ids to remove entirely, including all opaque sub-fields on that entity. */
  remove?: readonly string[];
  /** Explicit full declared order after this edit (ids). Omitted: existing order is kept, upserts appended. */
  order?: readonly string[];
}

export interface OwnedProjectEdit {
  /** Top-level scalar/object field replacements this writer owns and intends to set. */
  fields?: Readonly<Record<string, unknown>>;
  /** Identity-bearing top-level collections (characters/worlds) to merge by stable id, never position. */
  collections?: Readonly<Partial<Record<CoreCollection, EntityCollectionEdit>>>;
}

export type ProjectWritebackResult =
  | { status: 'COMMITTED'; raw: CanonicalProjectRawText; generation: ProjectSourceGeneration }
  | {
      status: 'CONFLICT';
      expectedGeneration: ProjectSourceGeneration;
      actualGeneration: ProjectSourceGeneration;
    }
  | { status: 'VERIFICATION_FAILED'; reason: string }
  | { status: 'MALFORMED_SOURCE'; reason: string }
  | { status: 'NOT_ADMITTED_FOR_WRITE'; classification: string };

// ---------------------------------------------------------------------------
// Source-generation token
// ---------------------------------------------------------------------------

// QNBS-v3: FNV-1a is a fast, well-known non-cryptographic hash -- a local change-detection token, not a security boundary.
export function computeProjectSourceGeneration(
  raw: CanonicalProjectRawText,
): ProjectSourceGeneration {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Unsafe-integer protection -- entity-collection subtrees are parsed to merge by id; a plain
// JSON.parse/stringify round trip silently rounds any integer beyond Number.MAX_SAFE_INTEGER, which
// would violate the contract's exact-numeric-precision no-loss requirement (§4) for an untouched
// opaque numeric field on an entity this edit doesn't otherwise touch.
// ---------------------------------------------------------------------------

// QNBS-v3: a fixed marker string can collide with a legitimate opaque document value; a fresh per-call random nonce (PUA-wrapped, since a raw U+0000..U+001F control character is illegal in a JSON string) cannot, since it doesn't exist until generated.
function createProtectionMarker(): string {
  return `\uE000WS_RAW_NUMBER_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}\uE001`;
}
const JSON_NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class RawNumberLiteral {
  constructor(public readonly text: string) {}
}

function isUnsafeIntegerLiteral(literal: string): boolean {
  if (!/^-?\d+$/.test(literal)) return false;
  try {
    const value = BigInt(literal);
    return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER);
  } catch {
    return false;
  }
}

type RawScanStep = { text: string; nextIndex: number };

function protectStringToken(raw: string, index: number): RawScanStep {
  const stringEnd = skipRawJsonString(raw, index);
  return stringEnd === null
    ? { text: raw.slice(index), nextIndex: raw.length }
    : { text: raw.slice(index, stringEnd), nextIndex: stringEnd };
}

function isNumberLiteralStart(character: string | undefined): boolean {
  if (character === undefined) return false;
  return character === '-' || (character >= '0' && character <= '9');
}

function matchNumberLiteralAt(raw: string, index: number): string | null {
  JSON_NUMBER_PATTERN.lastIndex = index;
  const match = JSON_NUMBER_PATTERN.exec(raw);
  const matchedAtIndex = match !== null && match.index === index && match[0].length > 0;
  return matchedAtIndex ? (match?.[0] ?? null) : null;
}

function protectNumberToken(raw: string, index: number, marker: string): RawScanStep | null {
  if (!isNumberLiteralStart(raw[index])) return null;
  const literal = matchNumberLiteralAt(raw, index);
  if (literal === null) return null;
  const text = isUnsafeIntegerLiteral(literal) ? `"${marker}${literal}"` : literal;
  return { text, nextIndex: index + literal.length };
}

/** Rewrites any unsafe-integer literal outside a JSON string as a quoted, marker-prefixed sentinel. */
function protectUnsafeIntegers(raw: string, marker: string): string {
  let result = '';
  let index = 0;
  while (index < raw.length) {
    const character = raw[index];
    const step =
      character === '"' ? protectStringToken(raw, index) : protectNumberToken(raw, index, marker);
    if (step) {
      result += step.text;
      index = step.nextIndex;
      continue;
    }
    result += character;
    index++;
  }
  return result;
}

function reviveRawNumberMarkersInObject(value: object, marker: string): Record<string, unknown> {
  // QNBS-v3: Object.create(null) (not {}) so a legitimately-named "__proto__" field becomes a real own property instead of silently hitting the prototype-setter accessor and being dropped.
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, entryValue] of Object.entries(value))
    result[key] = reviveRawNumberMarkers(entryValue, marker);
  return result;
}

type ReviveHandler = { test: (value: unknown) => boolean; revive: (value: unknown) => unknown };

// QNBS-v3: a data-driven dispatch table keeps this a single lookup instead of a branch per JSON value kind.
function buildReviveHandlers(marker: string): readonly ReviveHandler[] {
  return [
    {
      test: (value) => typeof value === 'string' && value.startsWith(marker),
      revive: (value) => new RawNumberLiteral((value as string).slice(marker.length)),
    },
    {
      test: Array.isArray,
      revive: (value) => (value as unknown[]).map((entry) => reviveRawNumberMarkers(entry, marker)),
    },
    {
      test: (value) => value !== null && typeof value === 'object',
      revive: (value) => reviveRawNumberMarkersInObject(value as object, marker),
    },
  ];
}

function reviveRawNumberMarkers(value: unknown, marker: string): unknown {
  const handler = buildReviveHandlers(marker).find((candidate) => candidate.test(value));
  return handler ? handler.revive(value) : value;
}

function stringifyObjectPreservingRawNumbers(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(
      ([key, entryValue]) => `${JSON.stringify(key)}:${stringifyPreservingRawNumbers(entryValue)}`,
    );
  return `{${entries.join(',')}}`;
}

type StringifyHandler = {
  test: (value: unknown) => boolean;
  stringify: (value: unknown) => string;
};

// QNBS-v3: a data-driven dispatch table keeps this a single lookup instead of a branch per JSON value kind.
const STRINGIFY_HANDLERS: readonly StringifyHandler[] = [
  {
    test: (value) => value instanceof RawNumberLiteral,
    stringify: (value) => (value as RawNumberLiteral).text,
  },
  { test: (value) => value === null || value === undefined, stringify: () => 'null' },
  {
    test: (value) =>
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
    stringify: (value) => JSON.stringify(value),
  },
  {
    test: Array.isArray,
    stringify: (value) => `[${(value as unknown[]).map(stringifyPreservingRawNumbers).join(',')}]`,
  },
  {
    test: (value) => typeof value === 'object',
    stringify: (value) => stringifyObjectPreservingRawNumbers(value as Record<string, unknown>),
  },
];

/** JSON.stringify equivalent that emits a RawNumberLiteral as its original, precision-exact text. */
function stringifyPreservingRawNumbers(value: unknown): string {
  const handler = STRINGIFY_HANDLERS.find((candidate) => candidate.test(value));
  if (!handler)
    throw new Error(`projectDocumentWriteback: cannot stringify value of type ${typeof value}`);
  return handler.stringify(value);
}

function rawNumberLiteralsEqual(left: unknown, right: unknown): boolean | null {
  if (left instanceof RawNumberLiteral && right instanceof RawNumberLiteral)
    return left.text === right.text;
  if (left instanceof RawNumberLiteral) return Number(left.text) === right;
  if (right instanceof RawNumberLiteral) return left === Number(right.text);
  return null;
}

function arraysDeepEqual(left: unknown, right: unknown): boolean {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => deepEqual(entry, right[index]))
  );
}

function objectsDeepEqual(left: object, right: object): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

type DeepEqualHandler = {
  test: (left: unknown, right: unknown) => boolean;
  equal: (left: unknown, right: unknown) => boolean;
};

// QNBS-v3: a data-driven dispatch table keeps this a single lookup instead of a branch per comparison kind.
const DEEP_EQUAL_HANDLERS: readonly DeepEqualHandler[] = [
  { test: (left, right) => left === right, equal: () => true },
  {
    test: (left, right) => left instanceof RawNumberLiteral || right instanceof RawNumberLiteral,
    equal: (left, right) => rawNumberLiteralsEqual(left, right) ?? false,
  },
  { test: (left, right) => Array.isArray(left) || Array.isArray(right), equal: arraysDeepEqual },
  {
    test: (left, right) =>
      Boolean(left) && Boolean(right) && typeof left === 'object' && typeof right === 'object',
    equal: (left, right) => objectsDeepEqual(left as object, right as object),
  },
];

function deepEqual(left: unknown, right: unknown): boolean {
  const handler = DEEP_EQUAL_HANDLERS.find((candidate) => candidate.test(left, right));
  return handler ? handler.equal(left, right) : false;
}

// ---------------------------------------------------------------------------
// Raw top-level member helpers
// ---------------------------------------------------------------------------

function findMemberValueRange(
  raw: string,
  member: CanonicalRawObjectMember,
): { start: number; end: number } | null {
  const keyEnd = skipRawJsonString(raw, member.start);
  if (keyEnd === null) return null;
  let index = skipRawJsonWhitespace(raw, keyEnd);
  if (raw[index] !== ':') return null;
  index = skipRawJsonWhitespace(raw, index + 1);
  const valueEnd = skipRawJsonValue(raw, index);
  if (valueEnd === null || valueEnd !== member.valueEnd) return null;
  return { start: index, end: member.valueEnd };
}

function findTopLevelMember(
  members: readonly CanonicalRawObjectMember[],
  key: string,
): CanonicalRawObjectMember | null {
  return members.find((member) => member.key === key) ?? null;
}

type FieldReplacement = { start: number; end: number; text: string };

function collectFieldReplacements(
  raw: string,
  members: readonly CanonicalRawObjectMember[],
  fields: Readonly<Record<string, unknown>>,
): { replacements: FieldReplacement[]; seenKeys: Set<string> } | null {
  const replacements: FieldReplacement[] = [];
  const seenKeys = new Set<string>();
  for (const member of members) {
    if (!Object.hasOwn(fields, member.key) || seenKeys.has(member.key)) continue;
    seenKeys.add(member.key);
    const range = findMemberValueRange(raw, member);
    if (range === null) return null;
    replacements.push({
      start: range.start,
      end: range.end,
      text: JSON.stringify(fields[member.key]),
    });
  }
  return { replacements, seenKeys };
}

function applyFieldReplacements(raw: string, replacements: readonly FieldReplacement[]): string {
  let result = raw;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}

function insertNewTopLevelFields(
  raw: string,
  objectStart: number,
  newKeys: readonly string[],
  fields: Readonly<Record<string, unknown>>,
): string {
  if (newKeys.length === 0) return raw;
  let firstMember = objectStart + 1;
  while (/\s/.test(raw[firstMember] ?? '')) firstMember++;
  const isEmptyObject = raw[firstMember] === '}';
  const insertion = newKeys
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(fields[key])}`)
    .join(',');
  const separator = isEmptyObject ? '' : ',';
  return `${raw.slice(0, objectStart + 1)}${insertion}${separator}${raw.slice(objectStart + 1)}`;
}

/** Replaces existing top-level keys in place and appends any new ones, touching no other byte. */
function overlayTopLevelFields(
  raw: string,
  fields: Readonly<Record<string, unknown>>,
): string | null {
  const keys = Object.keys(fields);
  if (keys.length === 0) return raw;

  const members = readTopLevelObjectMembers(raw);
  if (members === null) return null;

  const objectStart = raw.search(/\S/);
  if (objectStart === -1 || raw[objectStart] !== '{') return null;

  const collected = collectFieldReplacements(raw, members, fields);
  if (collected === null) return null;

  const replaced = applyFieldReplacements(raw, collected.replacements);
  const newKeys = keys.filter((key) => !collected.seenKeys.has(key));
  return insertNewTopLevelFields(replaced, objectStart, newKeys, fields);
}

// ---------------------------------------------------------------------------
// Entity-collection merge (characters / worlds) -- identity-by-id, never position (contract §3.2)
// ---------------------------------------------------------------------------

interface ReadCollectionResult {
  entities: EntityLike[];
  isEntityStateShape: boolean;
  valueRange: { start: number; end: number };
  /** The parsed value exactly as read, before EntityState normalization -- preserves any opaque envelope member beyond `ids`/`entities`. */
  originalValue: unknown;
}

// QNBS-v3: proves the marker absent from THIS source slice before use -- entropy alone makes collision astronomically unlikely, but proof makes the guarantee absolute rather than probabilistic.
function createUniqueProtectionMarker(sourceText: string): string {
  let marker = createProtectionMarker();
  while (sourceText.includes(marker)) marker = createProtectionMarker();
  return marker;
}

function parseEntityCollectionValue(
  raw: string,
  valueRange: { start: number; end: number },
  key: CoreCollection,
): { value: unknown } | { error: string } {
  const sourceText = raw.slice(valueRange.start, valueRange.end);
  const marker = createUniqueProtectionMarker(sourceText);
  try {
    const parsed = JSON.parse(protectUnsafeIntegers(sourceText, marker));
    return { value: reviveRawNumberMarkers(parsed, marker) };
  } catch {
    return { error: `collection "${key}" is not valid JSON` };
  }
}

function isEntityStateShaped(value: unknown): value is EntityState<EntityLike, string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'ids') &&
    Object.hasOwn(value, 'entities')
  );
}

function normalizeToEntityArray(
  value: unknown,
  isEntityStateShape: boolean,
  key: CoreCollection,
): { entities: EntityLike[] } | { error: string } {
  try {
    if (isEntityStateShape) {
      return { entities: entityStateToCoreArray(value as EntityState<EntityLike, string>, key) };
    }
    if (Array.isArray(value)) {
      return {
        entities: entityStateToCoreArray(coreArrayToEntityState(value as EntityLike[], key), key),
      };
    }
    return { error: `collection "${key}" is neither an array nor an EntityState` };
  } catch (cause) {
    return {
      error: `collection "${key}": ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

function readEntityCollection(
  raw: string,
  key: CoreCollection,
): ReadCollectionResult | null | { error: string } {
  const members = readTopLevelObjectMembers(raw);
  if (members === null) return null;
  const member = findTopLevelMember(members, key);
  if (member === null) return { error: `collection "${key}" is not present in the raw payload` };
  const valueRange = findMemberValueRange(raw, member);
  if (valueRange === null) return null;

  const parsed = parseEntityCollectionValue(raw, valueRange, key);
  if ('error' in parsed) return parsed;

  const isEntityStateShape = isEntityStateShaped(parsed.value);
  const normalized = normalizeToEntityArray(parsed.value, isEntityStateShape, key);
  if ('error' in normalized) return normalized;

  return {
    entities: normalized.entities,
    isEntityStateShape,
    valueRange,
    originalValue: parsed.value,
  };
}

function resolveExplicitOrder(
  byId: ReadonlyMap<string, EntityLike>,
  order: readonly string[],
): { order: string[] } | { error: string } {
  const expected = new Set(byId.keys());
  const provided = new Set(order);
  if (
    order.length !== provided.size ||
    expected.size !== provided.size ||
    ![...expected].every((id) => provided.has(id))
  ) {
    return { error: 'explicit order does not match the resulting entity set' };
  }
  return { order: [...order] };
}

function resolveImplicitOrder(
  originalEntities: readonly EntityLike[],
  byId: ReadonlyMap<string, EntityLike>,
  upsert: readonly EntityLike[],
): string[] {
  const survivingOriginalOrder = originalEntities
    .map((entity) => entity.id)
    .filter((id) => byId.has(id));
  const newIds = upsert
    .map((entity) => entity.id)
    .filter((id) => !survivingOriginalOrder.includes(id));
  return [...survivingOriginalOrder, ...newIds];
}

function applyEntityCollectionEdit(
  entities: readonly EntityLike[],
  edit: EntityCollectionEdit,
): { entities: EntityLike[] } | { error: string } {
  const byId = new Map<string, EntityLike>(entities.map((entity) => [entity.id, entity]));
  for (const id of edit.remove ?? []) byId.delete(id);
  for (const entity of edit.upsert ?? []) byId.set(entity.id, entity);

  const orderResult = edit.order
    ? resolveExplicitOrder(byId, edit.order)
    : { order: resolveImplicitOrder(entities, byId, edit.upsert ?? []) };
  if ('error' in orderResult) return orderResult;

  const result = orderResult.order.map((id) => {
    const entity = byId.get(id);
    if (!entity)
      throw new Error(`projectDocumentWriteback: internal invariant violated for id "${id}"`);
    return entity;
  });
  return { entities: result };
}

/** Rebuilds the `{ids, entities}` envelope while preserving any opaque member beyond those two. */
function buildEntityStateEnvelope(
  originalValue: unknown,
  entities: readonly EntityLike[],
  key: CoreCollection,
): Record<string, unknown> {
  const computed = coreArrayToEntityState(entities, key) as unknown as Record<string, unknown>;
  const hasOpaqueEnvelope =
    originalValue !== null && typeof originalValue === 'object' && !Array.isArray(originalValue);
  return hasOpaqueEnvelope ? { ...(originalValue as object), ...computed } : computed;
}

function overlayEntityCollection(
  raw: string,
  key: CoreCollection,
  edit: EntityCollectionEdit,
): string | { error: string } | null {
  const read = readEntityCollection(raw, key);
  if (read === null) return null;
  if ('error' in read) return read;

  const applied = applyEntityCollectionEdit(read.entities, edit);
  if ('error' in applied) return { error: `collection "${key}": ${applied.error}` };

  const outputValue = read.isEntityStateShape
    ? buildEntityStateEnvelope(read.originalValue, applied.entities, key)
    : applied.entities;
  const newValueText = stringifyPreservingRawNumbers(outputValue);
  return raw.slice(0, read.valueRange.start) + newValueText + raw.slice(read.valueRange.end);
}

function computeExpectedEntityIds(
  originalEntities: readonly EntityLike[],
  edit: EntityCollectionEdit,
): Set<string> {
  const removeSet = new Set(edit.remove ?? []);
  const expectedIds = new Set<string>();
  for (const entity of originalEntities) if (!removeSet.has(entity.id)) expectedIds.add(entity.id);
  for (const entity of edit.upsert ?? []) expectedIds.add(entity.id);
  return expectedIds;
}

function verifyEntityCollectionMembership(
  key: CoreCollection,
  updatedIds: readonly string[],
  expectedIds: ReadonlySet<string>,
  order: readonly string[] | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (updatedIds.length !== expectedIds.size || !updatedIds.every((id) => expectedIds.has(id))) {
    return { ok: false, reason: `collection "${key}" entity set does not match the intended edit` };
  }
  if (order && order.join(' ') !== updatedIds.join(' ')) {
    return {
      ok: false,
      reason: `collection "${key}" order does not match the explicit intended order`,
    };
  }
  return { ok: true };
}

function verifyEntityCollectionValues(
  key: CoreCollection,
  updatedEntities: readonly EntityLike[],
  originalById: ReadonlyMap<string, EntityLike>,
  upsertMap: ReadonlyMap<string, EntityLike>,
): { ok: true } | { ok: false; reason: string } {
  for (const entity of updatedEntities) {
    const intended = upsertMap.get(entity.id);
    if (intended) {
      if (!deepEqual(entity, intended)) {
        return {
          ok: false,
          reason: `collection "${key}" entity "${entity.id}" does not match the intended upsert value`,
        };
      }
      continue;
    }
    const untouched = originalById.get(entity.id);
    if (!untouched || !deepEqual(entity, untouched)) {
      return {
        ok: false,
        reason: `collection "${key}" untouched entity "${entity.id}" changed unexpectedly`,
      };
    }
  }
  return { ok: true };
}

/** The before/after raw carrier text a verification step compares -- grouped since every step needs both. */
type RawTextComparison = { originalRaw: CanonicalProjectRawText; newRaw: CanonicalProjectRawText };

function verifyEntityCollectionApplied(
  raws: RawTextComparison,
  key: CoreCollection,
  edit: EntityCollectionEdit,
): { ok: true } | { ok: false; reason: string } {
  const original = readEntityCollection(raws.originalRaw, key);
  const updated = readEntityCollection(raws.newRaw, key);
  if (original === null || updated === null) {
    return { ok: false, reason: `failed to re-parse collection "${key}" for verification` };
  }
  if ('error' in original) return { ok: false, reason: `verification: ${original.error}` };
  if ('error' in updated) return { ok: false, reason: `verification: ${updated.error}` };

  const expectedIds = computeExpectedEntityIds(original.entities, edit);
  const updatedIds = updated.entities.map((entity) => entity.id);
  const membership = verifyEntityCollectionMembership(key, updatedIds, expectedIds, edit.order);
  if (!membership.ok) return membership;

  const originalById = new Map(original.entities.map((entity) => [entity.id, entity]));
  const upsertMap = new Map((edit.upsert ?? []).map((entity) => [entity.id, entity]));
  return verifyEntityCollectionValues(key, updated.entities, originalById, upsertMap);
}

// ---------------------------------------------------------------------------
// Two-sided verification (contract §3.2, decision row 15)
// ---------------------------------------------------------------------------

function verifyOwnedEditApplied(
  raws: RawTextComparison,
  edit: OwnedProjectEdit,
): { ok: true } | { ok: false; reason: string } {
  const originalMembers = readTopLevelObjectMembers(raws.originalRaw);
  const newMembers = readTopLevelObjectMembers(raws.newRaw);
  if (originalMembers === null || newMembers === null) {
    return { ok: false, reason: 'failed to re-parse top-level members after overlay' };
  }

  const touchedKeys = new Set<string>([
    ...Object.keys(edit.fields ?? {}),
    ...Object.keys(edit.collections ?? {}),
  ]);
  const originalByKey = new Map(originalMembers.map((member) => [member.key, member]));
  const newByKey = new Map(newMembers.map((member) => [member.key, member]));

  const unownedFields = verifyUnownedFieldsPreserved(raws, originalByKey, newByKey, touchedKeys);
  if (!unownedFields.ok) return unownedFields;

  const ownedFields = verifyOwnedFieldsMatchIntent(raws.newRaw, newByKey, edit.fields ?? {});
  if (!ownedFields.ok) return ownedFields;

  for (const [key, collectionEdit] of Object.entries(edit.collections ?? {})) {
    const verification = verifyEntityCollectionApplied(
      raws,
      key as CoreCollection,
      collectionEdit as EntityCollectionEdit,
    );
    if (!verification.ok) return verification;
  }

  return { ok: true };
}

/** Every top-level field the edit doesn't own must remain byte-identical, and no unexpected field may appear. */
function verifyUnownedFieldUnchanged(
  raws: RawTextComparison,
  key: string,
  originalMember: CanonicalRawObjectMember,
  newMember: CanonicalRawObjectMember | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!newMember) return { ok: false, reason: `unowned field "${key}" disappeared after overlay` };
  const originalRange = findMemberValueRange(raws.originalRaw, originalMember);
  const newRange = findMemberValueRange(raws.newRaw, newMember);
  if (originalRange === null || newRange === null) {
    return { ok: false, reason: `failed to re-locate unowned field "${key}" after overlay` };
  }
  const unchanged =
    raws.originalRaw.slice(originalRange.start, originalRange.end) ===
    raws.newRaw.slice(newRange.start, newRange.end);
  return unchanged
    ? { ok: true }
    : { ok: false, reason: `unowned field "${key}" changed after overlay` };
}

function verifyNoUnexpectedNewFields(
  originalByKey: ReadonlyMap<string, CanonicalRawObjectMember>,
  newByKey: ReadonlyMap<string, CanonicalRawObjectMember>,
  touchedKeys: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: string } {
  for (const key of newByKey.keys()) {
    if (!originalByKey.has(key) && !touchedKeys.has(key)) {
      return { ok: false, reason: `unexpected new top-level field "${key}" introduced by overlay` };
    }
  }
  return { ok: true };
}

function verifyUnownedFieldsPreserved(
  raws: RawTextComparison,
  originalByKey: ReadonlyMap<string, CanonicalRawObjectMember>,
  newByKey: ReadonlyMap<string, CanonicalRawObjectMember>,
  touchedKeys: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: string } {
  for (const [key, originalMember] of originalByKey) {
    if (touchedKeys.has(key)) continue;
    const result = verifyUnownedFieldUnchanged(raws, key, originalMember, newByKey.get(key));
    if (!result.ok) return result;
  }
  return verifyNoUnexpectedNewFields(originalByKey, newByKey, touchedKeys);
}

/** Every owned scalar/object field must equal the intended value exactly after the overlay. */
function verifyOwnedFieldsMatchIntent(
  newRaw: string,
  newByKey: ReadonlyMap<string, CanonicalRawObjectMember>,
  fields: Readonly<Record<string, unknown>>,
): { ok: true } | { ok: false; reason: string } {
  for (const [key, intendedValue] of Object.entries(fields)) {
    const newMember = newByKey.get(key);
    if (!newMember) return { ok: false, reason: `owned field "${key}" missing after overlay` };
    const range = findMemberValueRange(newRaw, newMember);
    if (range === null) return { ok: false, reason: `failed to re-locate owned field "${key}"` };
    let actualValue: unknown;
    try {
      actualValue = JSON.parse(newRaw.slice(range.start, range.end));
    } catch {
      return { ok: false, reason: `owned field "${key}" is not valid JSON after overlay` };
    }
    if (!deepEqual(actualValue, intendedValue)) {
      return {
        ok: false,
        reason: `owned field "${key}" does not match the intended value after overlay`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

type AdmissionCheck = { ok: true } | { ok: false; result: ProjectWritebackResult };

function hasDuplicateTopLevelKeys(members: readonly CanonicalRawObjectMember[]): boolean {
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.key)) return true;
    seen.add(member.key);
  }
  return false;
}

// QNBS-v3 (#553): a non-CURRENT document (MALFORMED/FUTURE/UNSUPPORTED_OLDER/LEGACY_UNVERSIONED) never gains write authority through this primitive, regardless of caller discipline upstream.
type AdmissionRequest = {
  currentRaw: CanonicalProjectRawText;
  expectedGeneration: ProjectSourceGeneration;
};

function admitCurrentDocumentForWrite({
  currentRaw,
  expectedGeneration,
}: AdmissionRequest): AdmissionCheck {
  const classification = classifyRawProjectVersion(currentRaw);
  if (classification !== 'CURRENT') {
    return { ok: false, result: { status: 'NOT_ADMITTED_FOR_WRITE', classification } };
  }
  const actualGeneration = computeProjectSourceGeneration(currentRaw);
  if (actualGeneration !== expectedGeneration) {
    return { ok: false, result: { status: 'CONFLICT', expectedGeneration, actualGeneration } };
  }
  // QNBS-v3: readTopLevelObjectMembers subsumes the "is this a JSON object" check and lets us also refuse an ambiguous duplicate top-level key, since JSON.parse's last-occurrence-wins semantics disagree with a first-match lookup.
  const members = readTopLevelObjectMembers(currentRaw);
  if (members === null) {
    return {
      ok: false,
      result: { status: 'MALFORMED_SOURCE', reason: 'current raw payload is not a JSON object' },
    };
  }
  if (hasDuplicateTopLevelKeys(members)) {
    return {
      ok: false,
      result: {
        status: 'MALFORMED_SOURCE',
        reason: 'current raw payload has a duplicate top-level key',
      },
    };
  }
  return { ok: true };
}

type EditApplication = { ok: true; raw: string } | { ok: false; result: ProjectWritebackResult };

// QNBS-v3 (#553): admission only classifies `currentRaw` before the edit; owning "schemaVersion" like an ordinary field could move the committed result past admission's protection -- a schema migration is a distinct, later slice, out of scope here.
function rejectsSchemaVersionField(
  fields: Readonly<Record<string, unknown>>,
): { status: 'VERIFICATION_FAILED'; reason: string } | null {
  return Object.hasOwn(fields, 'schemaVersion')
    ? {
        status: 'VERIFICATION_FAILED',
        reason: 'schemaVersion cannot be set through an owned-field edit',
      }
    : null;
}

function applyOwnedFieldsStep(
  raw: string,
  fields: Readonly<Record<string, unknown>> | undefined,
): EditApplication {
  if (!fields || Object.keys(fields).length === 0) return { ok: true, raw };
  const rejection = rejectsSchemaVersionField(fields);
  if (rejection) return { ok: false, result: rejection };
  const overlaid = overlayTopLevelFields(raw, fields);
  return overlaid === null
    ? {
        ok: false,
        result: {
          status: 'MALFORMED_SOURCE',
          reason: 'failed to overlay owned fields onto the raw payload',
        },
      }
    : { ok: true, raw: overlaid };
}

function applyOwnedCollectionsStep(
  raw: string,
  collections: OwnedProjectEdit['collections'],
): EditApplication {
  let working = raw;
  for (const [key, collectionEdit] of Object.entries(collections ?? {})) {
    const result = overlayEntityCollection(
      working,
      key as CoreCollection,
      collectionEdit as EntityCollectionEdit,
    );
    if (result === null) {
      return {
        ok: false,
        result: {
          status: 'MALFORMED_SOURCE',
          reason: `failed to re-parse the raw payload for collection "${key}"`,
        },
      };
    }
    if (typeof result === 'object') {
      return { ok: false, result: { status: 'VERIFICATION_FAILED', reason: result.error } };
    }
    working = result;
  }
  return { ok: true, raw: working };
}

/**
 * Fences, overlays, and verifies one writer's owned-path edit onto the canonical raw carrier.
 *
 * `currentRaw` must be freshly read by the caller from the actual storage location immediately
 * before calling this function, inside whatever atomic primitive that backend provides (an
 * IndexedDB transaction, a filesystem compare-and-swap, etc.) -- this function performs the fence
 * comparison and the overlay/verify computation, but the caller is responsible for making the
 * read-check-and-eventual-write one indivisible operation at the storage layer; this function alone
 * cannot make a two-step read-then-write race-free.
 */
export function commitOwnedProjectEdit(params: {
  expectedGeneration: ProjectSourceGeneration;
  currentRaw: CanonicalProjectRawText;
  edit: OwnedProjectEdit;
}): ProjectWritebackResult {
  const admission = admitCurrentDocumentForWrite(params);
  if (!admission.ok) return admission.result;

  const fieldsStep = applyOwnedFieldsStep(params.currentRaw, params.edit.fields);
  if (!fieldsStep.ok) return fieldsStep.result;

  const collectionsStep = applyOwnedCollectionsStep(fieldsStep.raw, params.edit.collections);
  if (!collectionsStep.ok) return collectionsStep.result;

  const verification = verifyOwnedEditApplied(
    { originalRaw: params.currentRaw, newRaw: collectionsStep.raw },
    params.edit,
  );
  if (!verification.ok) {
    return { status: 'VERIFICATION_FAILED', reason: verification.reason };
  }

  return {
    status: 'COMMITTED',
    raw: collectionsStep.raw,
    generation: computeProjectSourceGeneration(collectionsStep.raw),
  };
}
