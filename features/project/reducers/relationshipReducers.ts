import type { PayloadAction } from '@reduxjs/toolkit';
import type { CharacterRelationship } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Character-relationship reducer cases extracted from projectSlice.
export const relationshipReducers = {
  addRelationship: (state: ProjectSliceState, action: PayloadAction<CharacterRelationship>) => {
    if (!state.data.relationships) state.data.relationships = [];
    state.data.relationships.push(action.payload);
  },
  updateRelationship: (
    state: ProjectSliceState,
    action: PayloadAction<{
      id: string;
      changes: Partial<CharacterRelationship>;
    }>,
  ) => {
    if (!state.data.relationships) state.data.relationships = [];
    const index = state.data.relationships.findIndex((r) => r.id === action.payload.id);
    if (index !== -1) {
      const relationship = state.data.relationships[index];
      if (relationship) {
        Object.assign(relationship, action.payload.changes);
      }
    }
  },
  deleteRelationship: (state: ProjectSliceState, action: PayloadAction<string>) => {
    if (!state.data.relationships) state.data.relationships = [];
    state.data.relationships = state.data.relationships.filter((r) => r.id !== action.payload);
  },
};
