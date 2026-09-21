import { entityStateToCoreArray } from '../features/project/coreBoundaryAdapter';
import type { ProjectData } from '../features/project/projectState';
import type { StoryProject } from '../types';
import {
  type CanonicalProjectRawText,
  type EntityCollectionEdit,
  type EntityLike,
  mergeRawCarrierValue,
  type OwnedProjectEdit,
  parseCanonicalRawPreservingUnsafeIntegers,
} from './projectDocumentWriteback';

/**
 * Bridges autosave's full-snapshot ProjectData input into an OwnedProjectEdit (#553 Phase D3).
 *
 * Pure bridge consumed by the production web/PWA autosave route. commitOwnedProjectEdit (#773) and the IDB canonical authority
 * (services/storage/idbProjectCanonicalAuthority.ts, #553 Phase D1/D2) both operate on an
 * OwnedProjectEdit describing what one writer intends to change; autosave instead always holds a
 * full ProjectData snapshot (the entire current Redux state), never a partial edit. This module is
 * the "smallest reusable bridge" between the two, not a Redux/storage redesign.
 *
 * The bridge owns only the declared ProjectData fields. Runtime projections can carry opaque
 * top-level or entity fields from a newer/foreign producer; those remain raw-carrier data rather
 * than becoming accidental overwrite authority. An explicitly-undefined-valued owned field is
 * omitted and removes a previously persisted optional field, while an unknown field is preserved.
 *
 * `characters`/`worlds` route through `collections` instead, matching commitOwnedProjectEdit's
 * stable-id merge-by-id semantics rather than a positional array replacement: `remove` is the set
 * difference between the ids the currently-committed raw carrier holds and the ids present now,
 * and `order` is the current, authoritative declared order. `upsert` merges each current entity
 * over its own prior raw counterpart (when one exists, in either the `{ids, entities}` or plain
 * array on-disk shape) rather than replacing it outright, so an opaque field the raw carrier holds
 * but the typed `Character`/`World` shape does not model survives -- an unmodified entity merged
 * over itself is a verified no-op, never a false change. The prior raw carrier is parsed through
 * the writeback module's unsafe-integer-preserving parser, so an opaque integer literal beyond
 * JS safe-integer precision survives byte-exactly instead of being rounded by a plain JSON.parse.
 * An explicitly-undefined-valued typed entity property is dropped before the merge, mirroring the
 * top-level `fields` rule: it can then neither reach canonical writeback as invalid content nor
 * clobber an opaque prior raw value.
 */

interface RawCollectionState {
  ids: readonly string[];
  entities: Readonly<Record<string, unknown>>;
}

// QNBS-v3 (#553): whitelist the current projection contract so bootstrap-spread opaque fields never become autosave write authority.
const OWNED_TOP_LEVEL_FIELDS = new Set([
  'id',
  'title',
  'logline',
  'author',
  'outline',
  'manuscript',
  'relationships',
  'projectGoals',
  'writingHistory',
  'writingSessions',
  'writingGoals',
  'sceneBoardLayout',
  'binderNodes',
  'compileProfile',
  'persistedVersionControl',
  'plotConnections',
  'plotSubplots',
  'plotTensionOverrides',
  'aiPreset',
  'storyObjects',
  'objectGroups',
  'mindMaps',
  'characterInterviews',
]);

const REMOVABLE_TOP_LEVEL_FIELDS = new Set([
  'author',
  'outline',
  'relationships',
  'projectGoals',
  'writingHistory',
  'writingSessions',
  'writingGoals',
  'sceneBoardLayout',
  'binderNodes',
  'compileProfile',
  'persistedVersionControl',
  'plotConnections',
  'plotSubplots',
  'plotTensionOverrides',
  'aiPreset',
  'storyObjects',
  'objectGroups',
  'mindMaps',
  'characterInterviews',
]);

const CHARACTER_FIELDS = new Set([
  'id',
  'name',
  'backstory',
  'motivation',
  'appearance',
  'personalityTraits',
  'flaws',
  'notes',
  'hasAvatar',
  'characterArc',
  'relationships',
]);

const WORLD_FIELDS = new Set([
  'id',
  'name',
  'description',
  'geography',
  'magicSystem',
  'culture',
  'notes',
  'hasAmbianceImage',
  'timeline',
  'locations',
  'relationships',
]);

const REMOVABLE_CHARACTER_FIELDS = new Set(['hasAvatar']);
const REMOVABLE_WORLD_FIELDS = new Set(['hasAmbianceImage', 'relationships']);

const WORLD_LOCATION_FIELDS = new Set([
  'id',
  'name',
  'description',
  'coordinates',
  'type',
  'population',
  'significance',
]);
const WORLD_LOCATION_REMOVABLE_FIELDS = new Set(['coordinates', 'population', 'significance']);
const WORLD_TIMELINE_FIELDS = new Set([
  'id',
  'era',
  'year',
  'title',
  'description',
  'date',
  'locationId',
  'characterIds',
]);
const WORLD_TIMELINE_REMOVABLE_FIELDS = new Set(['year', 'date', 'locationId', 'characterIds']);
const WORLD_RELATIONSHIP_FIELDS = new Set([
  'id',
  'fromCharacterId',
  'toCharacterId',
  'type',
  'description',
  'strength',
]);
const WORLD_RELATIONSHIP_REMOVABLE_FIELDS = new Set(['description']);

type NestedArrayRule = {
  fields: ReadonlySet<string>;
  removableFields: ReadonlySet<string>;
  nestedObjectFields?: Readonly<Record<string, ReadonlySet<string>>>;
};

const WORLD_NESTED_ARRAY_RULES: Readonly<Record<string, NestedArrayRule>> = {
  locations: {
    fields: WORLD_LOCATION_FIELDS,
    removableFields: WORLD_LOCATION_REMOVABLE_FIELDS,
    nestedObjectFields: { coordinates: new Set(['lat', 'lng']) },
  },
  timeline: {
    fields: WORLD_TIMELINE_FIELDS,
    removableFields: WORLD_TIMELINE_REMOVABLE_FIELDS,
  },
  relationships: {
    fields: WORLD_RELATIONSHIP_FIELDS,
    removableFields: WORLD_RELATIONSHIP_REMOVABLE_FIELDS,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdBearing(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value['id'] === 'string';
}

function definedKnownFields(
  value: unknown,
  ownedFields: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entryValue]) => ownedFields.has(key) && entryValue !== undefined,
    ),
  );
}

function mergeKnownNestedObject(
  value: unknown,
  rawValue: unknown,
  fields: ReadonlySet<string>,
  removableFields: ReadonlySet<string>,
  nestedObjectFields: Readonly<Record<string, ReadonlySet<string>>> = {},
): Record<string, unknown> {
  const merged = isRecord(rawValue) ? { ...rawValue } : {};
  if (!isRecord(value)) return merged;
  for (const key of fields) {
    if (Object.hasOwn(value, key) && value[key] !== undefined) {
      const nestedFields = nestedObjectFields[key];
      merged[key] = nestedFields
        ? mergeKnownNestedObject(value[key], merged[key], nestedFields, new Set())
        : mergeRawCarrierValue(value[key], merged[key]);
    } else if (removableFields.has(key)) {
      delete merged[key];
    }
  }
  return merged;
}

function mergeKnownNestedArray(value: unknown, rawValue: unknown, rule: NestedArrayRule): unknown {
  if (!Array.isArray(value)) return value;
  const rawById = new Map<string, unknown>();
  if (Array.isArray(rawValue)) {
    for (const rawEntry of rawValue) {
      if (isIdBearing(rawEntry)) rawById.set(rawEntry.id, rawEntry);
    }
  }
  return value.map((entry) => {
    if (!isIdBearing(entry)) return entry;
    return mergeKnownNestedObject(
      entry,
      rawById.get(entry.id),
      rule.fields,
      rule.removableFields,
      rule.nestedObjectFields,
    );
  });
}

function mergeKnownEntityFields(
  rawEntity: unknown,
  fields: Record<string, unknown>,
  nestedArrayRules: Readonly<Record<string, NestedArrayRule>> = {},
): Record<string, unknown> {
  const rawRecord = isRecord(rawEntity) ? rawEntity : {};
  for (const [key, value] of Object.entries(fields)) {
    const rule = nestedArrayRules[key];
    fields[key] = rule
      ? mergeKnownNestedArray(value, rawRecord[key], rule)
      : mergeRawCarrierValue(value, rawRecord[key]);
  }
  return fields;
}

function collectEntityFieldRemovals(
  entities: readonly { id: string }[],
  currentRaw: RawCollectionState,
  removableFields: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  const removals = Object.fromEntries(
    entities.flatMap((entity) => {
      const rawEntity = currentRaw.entities[entity.id];
      if (!isRecord(rawEntity)) return [];
      const entityRecord = entity as unknown as Record<string, unknown>;
      const fields = [...removableFields].filter(
        (key) =>
          Object.hasOwn(rawEntity, key) &&
          (!Object.hasOwn(entityRecord, key) || entityRecord[key] === undefined),
      );
      return fields.length > 0 ? [[entity.id, fields] as const] : [];
    }),
  );
  return removals;
}

// QNBS-v3: the Core boundary (features/project/coreBoundaryAdapter.ts) round-trips characters/worlds as a plain array outside Redux/IDB (filesystem, import/export); a raw carrier written through that path stores this shape, not {ids, entities}.
function readRawCollection(
  parsedCurrent: unknown,
  collection: 'characters' | 'worlds',
): RawCollectionState {
  if (!isRecord(parsedCurrent)) return { ids: [], entities: {} };
  const raw = parsedCurrent[collection];
  if (Array.isArray(raw)) {
    // QNBS-v3: Object.create(null) (not {}) so an id of "__proto__" becomes a real own property instead of hitting the inherited prototype setter (or reading Object.prototype back as a phantom merge base).
    const entities: Record<string, unknown> = Object.create(null);
    const ids: string[] = [];
    for (const entity of raw) {
      if (!isIdBearing(entity)) continue;
      ids.push(entity.id);
      entities[entity.id] = entity;
    }
    return { ids, entities };
  }
  if (isRecord(raw) && Array.isArray(raw['ids']) && isRecord(raw['entities'])) {
    const ids = raw['ids'].filter((id): id is string => typeof id === 'string');
    return { ids, entities: raw['entities'] };
  }
  return { ids: [], entities: {} };
}

function buildCollectionEdit(
  newEntities: readonly { id: string }[],
  currentRaw: RawCollectionState,
  ownedFields: ReadonlySet<string>,
  removableFields: ReadonlySet<string>,
  nestedArrayRules: Readonly<Record<string, NestedArrayRule>> = {},
): EntityCollectionEdit {
  const newIds = newEntities.map((entity) => entity.id);
  const newIdSet = new Set(newIds);
  const removedIds = currentRaw.ids.filter((id) => !newIdSet.has(id));
  const upsert = newEntities.map((entity) => {
    // QNBS-v3: same rule as top-level fields -- an explicitly-undefined typed property means "unowned" and must not clobber an opaque prior raw value in the merge.
    const definedEntity = definedKnownFields(entity, ownedFields);
    return mergeKnownEntityFields(currentRaw.entities[entity.id], definedEntity, nestedArrayRules);
  });
  const removeFields = collectEntityFieldRemovals(newEntities, currentRaw, removableFields);
  return {
    upsert: upsert as unknown as readonly EntityLike[],
    preserveExistingFields: true,
    ...(removedIds.length > 0 ? { remove: removedIds } : {}),
    ...(Object.keys(removeFields).length > 0 ? { removeFields } : {}),
    order: newIds,
  };
}

/**
 * Builds the OwnedProjectEdit describing autosave's full current ProjectData snapshot, fenced
 * against `currentRaw` -- the canonical authority's own currently-admitted raw text (from
 * `loadCanonicalProjectAdmission`), used only to compute the characters/worlds removal set and
 * opaque-field-preserving merge base; it is never re-serialized or otherwise trusted as the edit's
 * content.
 */
export function buildAutosaveOwnedProjectEdit(
  newData: ProjectData | StoryProject,
  currentRaw: CanonicalProjectRawText,
): OwnedProjectEdit {
  const { characters, worlds, ...rest } = newData;
  const parsedCurrent: unknown = parseCanonicalRawPreservingUnsafeIntegers(currentRaw);
  // QNBS-v3: schemaVersion and unknown bootstrap-spread properties stay admission/opaque-owned, never autosave-owned.
  const currentRecord = isRecord(parsedCurrent) ? parsedCurrent : null;
  const fields = mergeKnownEntityFields(
    currentRecord,
    definedKnownFields(rest, OWNED_TOP_LEVEL_FIELDS),
  );
  const removeFields = currentRecord
    ? [...REMOVABLE_TOP_LEVEL_FIELDS].filter(
        (key) => Object.hasOwn(currentRecord, key) && !Object.hasOwn(fields, key),
      )
    : [];
  const newCharacters = Array.isArray(characters)
    ? characters
    : entityStateToCoreArray(characters, 'characters');
  const newWorlds = Array.isArray(worlds) ? worlds : entityStateToCoreArray(worlds, 'worlds');
  return {
    fields,
    collections: {
      characters: buildCollectionEdit(
        newCharacters,
        readRawCollection(parsedCurrent, 'characters'),
        CHARACTER_FIELDS,
        REMOVABLE_CHARACTER_FIELDS,
      ),
      worlds: buildCollectionEdit(
        newWorlds,
        readRawCollection(parsedCurrent, 'worlds'),
        WORLD_FIELDS,
        REMOVABLE_WORLD_FIELDS,
        WORLD_NESTED_ARRAY_RULES,
      ),
    },
    ...(removeFields.length > 0 ? { removeFields } : {}),
  };
}
