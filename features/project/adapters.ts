import { createEntityAdapter } from '@reduxjs/toolkit';
import type { Character, World } from '../../types';

// QNBS-v3: the stable no-op comparer selects RTK's object-safe update path without changing entity insertion order.
const preserveEntityOrder = () => 0;

export const charactersAdapter = createEntityAdapter<Character>({
  sortComparer: preserveEntityOrder,
});
export const worldsAdapter = createEntityAdapter<World>({ sortComparer: preserveEntityOrder });
