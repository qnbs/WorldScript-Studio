import { entityStateToCoreArray } from '../features/project/coreBoundaryAdapter';
import type { ProjectData } from '../features/project/projectState';
import type { StoryProject } from '../types';
import {
  type CanonicalProjectRawText,
  type EntityCollectionEdit,
  type EntityLike,
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
): EntityCollectionEdit {
  const newIds = newEntities.map((entity) => entity.id);
  const newIdSet = new Set(newIds);
  const removedIds = currentRaw.ids.filter((id) => !newIdSet.has(id));
  const upsert = newEntities.map((entity) => {
    // QNBS-v3: same rule as top-level fields -- an explicitly-undefined typed property means "unowned" and must not clobber an opaque prior raw value in the merge.
    const definedEntity = definedKnownFields(entity, ownedFields);
    return definedEntity;
  });
  return {
    upsert: upsert as unknown as readonly EntityLike[],
    preserveExistingFields: true,
    ...(removedIds.length > 0 ? { remove: removedIds } : {}),
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
  const fields = definedKnownFields(rest, OWNED_TOP_LEVEL_FIELDS);
  const currentRecord = isRecord(parsedCurrent) ? parsedCurrent : null;
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
      ),
      worlds: buildCollectionEdit(
        newWorlds,
        readRawCollection(parsedCurrent, 'worlds'),
        WORLD_FIELDS,
      ),
    },
    ...(removeFields.length > 0 ? { removeFields } : {}),
  };
}
