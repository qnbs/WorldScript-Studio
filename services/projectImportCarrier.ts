/**
 * Import replacement carrier (#553 a4).
 *
 * An imported project's first save starts from the admitted import text, like a restored snapshot
 * does, so fields this build does not model and exact number tokens survive. The import thunk moves
 * inline character avatars and world ambiance images into image storage; the carrier drops exactly
 * those inline copies, so the stored project never duplicates them. Everything else is kept.
 */
import {
  type CanonicalProjectRawText,
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
  type EntityCollectionEdit,
  parseCanonicalRawPreservingUnsafeIntegers,
} from './projectDocumentWriteback';

const INLINE_IMAGE_FIELDS = { characters: 'avatarBase64', worlds: 'ambianceImageBase64' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectionEntities(collection: unknown): readonly unknown[] {
  if (Array.isArray(collection)) return collection;
  if (isRecord(collection) && isRecord(collection['entities'])) {
    return Object.values(collection['entities']);
  }
  return [];
}

// QNBS-v3 (#553 a4): the same truthiness test importProjectThunk uses before moving an image to image storage — an empty inline value is not transferred, so it is not removed either.
function hasTransferredImage(entity: unknown, field: string): entity is { id: string } {
  return isRecord(entity) && typeof entity['id'] === 'string' && Boolean(entity[field]);
}

function inlineImageRemovals(collection: unknown, field: string): EntityCollectionEdit | null {
  const ids = collectionEntities(collection)
    .filter((entity) => hasTransferredImage(entity, field))
    .map((entity) => (entity as { id: string }).id);
  if (ids.length === 0) return null;
  // QNBS-v3: Object.fromEntries defines own properties, so an entity id such as "__proto__" is kept as a real key instead of hitting the prototype setter.
  const removeFields = Object.fromEntries(ids.map((id) => [id, [field]]));
  // QNBS-v3: removals apply to upserted entities only — an id-only upsert merged over the existing entity keeps every stored field and its position.
  return { upsert: ids.map((id) => ({ id })), preserveExistingFields: true, removeFields };
}

/** The admitted import text without its inline image copies, or null when it cannot be prepared. */
export function buildImportReplacementCarrier(
  raw: CanonicalProjectRawText,
): CanonicalProjectRawText | null {
  let parsed: unknown;
  try {
    parsed = parseCanonicalRawPreservingUnsafeIntegers(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const collections: Partial<Record<keyof typeof INLINE_IMAGE_FIELDS, EntityCollectionEdit>> = {};
  for (const [key, field] of Object.entries(INLINE_IMAGE_FIELDS) as [
    keyof typeof INLINE_IMAGE_FIELDS,
    string,
  ][]) {
    const edit = inlineImageRemovals(parsed[key], field);
    if (edit) collections[key] = edit;
  }
  if (Object.keys(collections).length === 0) return raw;
  const result = commitOwnedProjectEdit({
    expectedGeneration: computeProjectSourceGeneration(raw),
    currentRaw: raw,
    edit: { collections },
  });
  // QNBS-v3: an unpreparable carrier degrades to the fresh first write (#839), never to a carrier that still holds image copies.
  return result.status === 'COMMITTED' ? result.raw : null;
}
