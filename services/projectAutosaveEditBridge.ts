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
 * `characters`/`worlds` route through `collections` instead, matching commitOwnedProjectEdit's
 * stable-id merge-by-id semantics rather than a positional array replacement: `upsert` is the
 * complete current entity list (an unmodified entity re-upserted with identical content is a
 * verified no-op, never a false change), `remove` is the set difference between the ids the
 * currently-committed raw carrier holds and the ids present now, and `order` is the current,
 * authoritative declared order.
 */

interface RawEntityCollectionShape {
  ids?: unknown;
}

function readRawCollectionIds(
  parsedCurrent: unknown,
  collection: 'characters' | 'worlds',
): string[] {
  if (typeof parsedCurrent !== 'object' || parsedCurrent === null) return [];
  const raw = (parsedCurrent as Record<string, unknown>)[collection] as
    | RawEntityCollectionShape
    | undefined;
  if (!raw || !Array.isArray(raw.ids)) return [];
  return raw.ids.filter((id): id is string => typeof id === 'string');
}

// QNBS-v3: concrete entity types (Character/World) have no index signature, so this accepts EntityLike (matching OwnedProjectEdit.collections' own default) rather than being generic -- the caller casts, since the runtime shape is identical either way.
function buildCollectionEdit(
  newEntities: readonly { id: string }[],
  currentRawIds: readonly string[],
): EntityCollectionEdit {
  const newIds = newEntities.map((entity) => entity.id);
  const newIdSet = new Set(newIds);
  const removedIds = currentRawIds.filter((id) => !newIdSet.has(id));
  return {
    upsert: newEntities as unknown as readonly EntityLike[],
    ...(removedIds.length > 0 ? { remove: removedIds } : {}),
    order: newIds,
  };
}

/**
 * Builds the OwnedProjectEdit describing autosave's full current ProjectData snapshot, fenced
 * against `currentRaw` -- the canonical authority's own currently-admitted raw text (from
 * `loadCanonicalProjectAdmission`), used only to compute the characters/worlds removal set; it is
 * never re-serialized or otherwise trusted as the edit's content.
 */
export function buildAutosaveOwnedProjectEdit(
  newData: ProjectData,
  currentRaw: CanonicalProjectRawText,
): OwnedProjectEdit {
  const { characters, worlds, ...fields } = newData;
  const parsedCurrent: unknown = JSON.parse(currentRaw);
  const newCharacters = entityStateToCoreArray(characters, 'characters');
  const newWorlds = entityStateToCoreArray(worlds, 'worlds');
  return {
    fields,
    collections: {
      characters: buildCollectionEdit(
        newCharacters,
        readRawCollectionIds(parsedCurrent, 'characters'),
      ),
      worlds: buildCollectionEdit(newWorlds, readRawCollectionIds(parsedCurrent, 'worlds')),
    },
  };
}
