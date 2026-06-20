import type { PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { Character } from '../../../types';
import { charactersAdapter } from '../adapters';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Character CRUD reducer cases extracted from projectSlice (EntityAdapter-backed).
export const characterReducers = {
  addCharacter: (
    state: ProjectSliceState,
    action: PayloadAction<Partial<Character> & { name: string }>,
  ) => {
    const newChar: Character = {
      id: uuidv4(),
      backstory: '',
      motivation: '',
      appearance: '',
      personalityTraits: '',
      flaws: '',
      notes: '',
      hasAvatar: false,
      characterArc: '',
      relationships: '',
      ...action.payload,
    };
    charactersAdapter.addOne(state.data.characters, newChar);
  },
  updateCharacter: (
    state: ProjectSliceState,
    action: PayloadAction<{ id: string; changes: Partial<Character> }>,
  ) => {
    charactersAdapter.updateOne(state.data.characters, {
      id: action.payload.id,
      changes: action.payload.changes,
    });
  },
  deleteCharacter: (state: ProjectSliceState, action: PayloadAction<string>) => {
    charactersAdapter.removeOne(state.data.characters, action.payload);
  },
};
