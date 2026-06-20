import type { PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { World } from '../../../types';
import { worldsAdapter } from '../adapters';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: World CRUD reducer cases extracted from projectSlice (EntityAdapter-backed).
export const worldReducers = {
  addWorld: (
    state: ProjectSliceState,
    action: PayloadAction<Partial<World> & { name: string }>,
  ) => {
    const newWorld: World = {
      id: uuidv4(),
      description: '',
      geography: '',
      magicSystem: '',
      culture: '',
      notes: '',
      hasAmbianceImage: false,
      timeline: [],
      locations: [],
      ...action.payload,
    };
    worldsAdapter.addOne(state.data.worlds, newWorld);
  },
  updateWorld: (
    state: ProjectSliceState,
    action: PayloadAction<{ id: string; changes: Partial<World> }>,
  ) => {
    worldsAdapter.updateOne(state.data.worlds, {
      id: action.payload.id,
      changes: action.payload.changes,
    });
  },
  deleteWorld: (state: ProjectSliceState, action: PayloadAction<string>) => {
    worldsAdapter.removeOne(state.data.worlds, action.payload);
  },
};
