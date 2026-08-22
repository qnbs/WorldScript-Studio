import type { EntityState } from '@reduxjs/toolkit';
import type { Character, World } from '../../types';

type CoreEntity = { id: string };
export type CoreCollection = 'characters' | 'worlds';

export class CoreBoundaryValidationError extends Error {
  constructor(
    public readonly collection: CoreCollection,
    reason: string,
  ) {
    super(`Core boundary ${collection}: ${reason}`);
    this.name = 'CoreBoundaryValidationError';
  }
}

function requireStableId(
  collection: CoreCollection,
  id: unknown,
  location: string,
): asserts id is string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CoreBoundaryValidationError(collection, `${location} is missing a stable id`);
  }
}

// QNBS-v3: Reject malformed Redux containers before data crosses into renderer-neutral Core arrays.
/** Converts an ordered Redux collection into the Core's renderer-neutral array shape. */
export function entityStateToCoreArray<T extends CoreEntity>(
  state: EntityState<T, string>,
  collection: CoreCollection,
): T[] {
  const seenIds = new Set<string>();
  const orderedEntities: T[] = [];

  for (const [index, id] of state.ids.entries()) {
    requireStableId(collection, id, `ids[${index}]`);
    if (seenIds.has(id)) {
      throw new CoreBoundaryValidationError(collection, `duplicate id "${id}" in ids`);
    }

    if (!Object.hasOwn(state.entities, id)) {
      throw new CoreBoundaryValidationError(collection, `ids references missing entity "${id}"`);
    }
    const entity = state.entities[id];
    if (!entity) {
      throw new CoreBoundaryValidationError(collection, `entity key "${id}" has no value`);
    }
    requireStableId(collection, entity.id, `entities[${id}].id`);
    if (entity.id !== id) {
      throw new CoreBoundaryValidationError(
        collection,
        `entity key "${id}" does not match entity id "${entity.id}"`,
      );
    }

    seenIds.add(id);
    orderedEntities.push(entity);
  }

  for (const [key, entity] of Object.entries(state.entities)) {
    if (!entity) {
      throw new CoreBoundaryValidationError(collection, `entity key "${key}" has no value`);
    }
    requireStableId(collection, entity.id, `entities[${key}].id`);
    if (entity.id !== key) {
      throw new CoreBoundaryValidationError(
        collection,
        `entity key "${key}" does not match entity id "${entity.id}"`,
      );
    }
    if (!seenIds.has(key)) {
      throw new CoreBoundaryValidationError(
        collection,
        `orphan entity "${key}" is absent from ids`,
      );
    }
  }

  return orderedEntities;
}

/** Converts a Core array into the Redux shape without changing its declared order. */
export function coreArrayToEntityState<T extends CoreEntity>(
  entities: readonly T[],
  collection: CoreCollection,
): EntityState<T, string> {
  const ids: string[] = [];
  const byId: Record<string, T> = Object.create(null);

  for (const [index, entity] of entities.entries()) {
    requireStableId(collection, entity?.id, `entities[${index}].id`);
    if (Object.hasOwn(byId, entity.id)) {
      throw new CoreBoundaryValidationError(collection, `duplicate id "${entity.id}" in array`);
    }
    ids.push(entity.id);
    byId[entity.id] = entity;
  }

  return { ids, entities: byId };
}

export interface ReduxProjectCollections {
  characters: EntityState<Character, string>;
  worlds: EntityState<World, string>;
}

export interface ProjectCollectionsInput {
  characters: Character[] | EntityState<Character, string>;
  worlds: World[] | EntityState<World, string>;
}

export interface CoreProjectCollections {
  characters: Character[];
  worlds: World[];
}

function validateCoreArray<T extends CoreEntity>(
  entities: readonly T[],
  collection: CoreCollection,
): T[] {
  const seenIds = new Set<string>();
  for (const [index, entity] of entities.entries()) {
    requireStableId(collection, entity?.id, `entities[${index}].id`);
    if (seenIds.has(entity.id)) {
      throw new CoreBoundaryValidationError(collection, `duplicate id "${entity.id}" in array`);
    }
    seenIds.add(entity.id);
  }
  return [...entities];
}

function normalizeCoreCollection<T extends CoreEntity>(
  collection: T[] | EntityState<T, string>,
  name: CoreCollection,
): T[] {
  return Array.isArray(collection)
    ? validateCoreArray(collection, name)
    : entityStateToCoreArray(collection, name);
}

/** The only collection conversion a future Core caller needs at the Redux boundary. */
export function toCoreProjectCollections(
  collections: ProjectCollectionsInput,
): CoreProjectCollections {
  return {
    characters: normalizeCoreCollection(collections.characters, 'characters'),
    worlds: normalizeCoreCollection(collections.worlds, 'worlds'),
  };
}

/** Rebuilds Redux containers only at the integration boundary; Core remains Redux-free. */
export function fromCoreProjectCollections(
  collections: CoreProjectCollections,
): ReduxProjectCollections {
  return {
    characters: coreArrayToEntityState(collections.characters, 'characters'),
    worlds: coreArrayToEntityState(collections.worlds, 'worlds'),
  };
}
