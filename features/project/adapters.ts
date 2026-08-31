import type { EntityState } from '@reduxjs/toolkit';
import { createEntityAdapter } from '@reduxjs/toolkit';
import type { Character, World } from '../../types';

// QNBS-v3: the stable no-op comparer selects RTK's object-safe update path without changing entity insertion order.
const preserveEntityOrder = () => 0;

// QNBS-v3: imported string IDs must survive EntityState construction even when they collide with Object.prototype.
/** Builds a JSON-safe EntityState without treating prototype names as inherited properties. */
export function createPrototypeSafeEntityState<T extends { id: string }>(
  items: readonly T[],
): EntityState<T, string> | undefined {
  const ids: string[] = [];
  const entities = Object.create(null) as Record<string, T>;
  for (const item of items) {
    if (Object.hasOwn(entities, item.id)) return undefined;
    ids.push(item.id);
    entities[item.id] = item;
  }
  return { ids, entities };
}

export const charactersAdapter = createEntityAdapter<Character>({
  sortComparer: preserveEntityOrder,
});
export const worldsAdapter = createEntityAdapter<World>({ sortComparer: preserveEntityOrder });
