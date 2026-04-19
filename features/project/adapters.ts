import { createEntityAdapter } from '@reduxjs/toolkit';
import type { Character, World } from '../../types';

export const charactersAdapter = createEntityAdapter<Character>();
export const worldsAdapter = createEntityAdapter<World>();
