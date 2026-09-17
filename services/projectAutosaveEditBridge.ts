import { entityStateToCoreArray } from '../features/project/coreBoundaryAdapter';
import type { ProjectData } from '../features/project/projectState';
import type {
  CanonicalProjectRawText,
  EntityCollectionEdit,
  EntityLike,
  OwnedProjectEdit,
} from './projectDocumentWriteback';

/**
 * Bridges autosave's full-snapshot ProjectData input into an OwnedProjectEdit (#553 Phase D3).
 *
 * Standalone and pure -- not yet wired into app/listenerMiddleware.ts's autosave effect or any
 * production writer. commitOwnedProjectEdit (#773) and the IDB canonical authority
 * (services/storage/idbProjectCanonicalAuthority.ts, #553 Phase D1/D2) both operate on an
 * OwnedProjectEdit describing what one writer intends to change; autosave instead always holds a
 * full ProjectData snapshot (the entire current Redux state), never a partial edit. This module is
 * the "smallest reusable bridge" between the two, not a Redux/storage redesign.
 *
 * Every non-collection top-level field is treated as owned by this edit -- autosave persists the
 * complete current project, so every field it carries is, by construction, its intended value.
 * An explicitly-undefined-valued field is dropped rather than forwarded: `undefined` is not a
 * valid JSON value, and a genuinely absent field is otherwise indistinguishable from one the
 * caller means to omit as unowned.
 *
 * `characters`/`worlds` route through `collections` instead, matching commitOwnedProjectEdit's
 * stable-id merge-by-id semantics rather than a positional array replacement: `remove` is the set
 * difference between the ids the currently-committed raw carrier holds and the ids present now,
 * and `order` is the current, authoritative declared order. `upsert` merges each current entity
 * over its own prior raw counterpart (when one exists, in either the `{ids, entities}` or plain
 * array on-disk shape) rather than replacing it outright, so an opaque field the raw carrier holds
 * but the typed `Character`/`World` shape does not model survives -- an unmodified entity merged
 * over itself is a verified no-op, never a false change.
 */

interface RawCollectionState {
  ids: readonly string[];
  entities: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdBearing(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value['id'] === 'string';
}

// QNBS-v3: the Core boundary (features/project/coreBoundaryAdapter.ts) round-trips characters/worlds as a plain array outside Redux/IDB (filesystem, import/export); a raw carrier written through that path stores this shape, not {ids, entities}.
function readRawCollection(
  parsedCurrent: unknown,
  collection: 'characters' | 'worlds',
): RawCollectionState {
  if (!isRecord(parsedCurrent)) return { ids: [], entities: {} };
  const raw = parsedCurrent[collection];
  if (Array.isArray(raw)) {
    const entities: Record<string, unknown> = {};
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
): EntityCollectionEdit {
  const newIds = newEntities.map((entity) => entity.id);
  const newIdSet = new Set(newIds);
  const removedIds = currentRaw.ids.filter((id) => !newIdSet.has(id));
  const upsert = newEntities.map((entity) => {
    const priorRaw = currentRaw.entities[entity.id];
    return isRecord(priorRaw) ? { ...priorRaw, ...entity } : entity;
  });
  return {
    upsert: upsert as unknown as readonly EntityLike[],
    ...(removedIds.length > 0 ? { remove: removedIds } : {}),
    order: newIds,
  };
}

function isDefinedEntry([, value]: readonly [string, unknown]): boolean {
  return value !== undefined;
}

/**
 * Builds the OwnedProjectEdit describing autosave's full current ProjectData snapshot, fenced
 * against `currentRaw` -- the canonical authority's own currently-admitted raw text (from
 * `loadCanonicalProjectAdmission`), used only to compute the characters/worlds removal set and
 * opaque-field-preserving merge base; it is never re-serialized or otherwise trusted as the edit's
 * content.
 */
export function buildAutosaveOwnedProjectEdit(
  newData: ProjectData,
  currentRaw: CanonicalProjectRawText,
): OwnedProjectEdit {
  const { characters, worlds, ...rest } = newData;
  const fields = Object.fromEntries(Object.entries(rest).filter(isDefinedEntry));
  const parsedCurrent: unknown = JSON.parse(currentRaw);
  const newCharacters = entityStateToCoreArray(characters, 'characters');
  const newWorlds = entityStateToCoreArray(worlds, 'worlds');
  return {
    fields,
    collections: {
      characters: buildCollectionEdit(
        newCharacters,
        readRawCollection(parsedCurrent, 'characters'),
      ),
      worlds: buildCollectionEdit(newWorlds, readRawCollection(parsedCurrent, 'worlds')),
    },
  };
}
