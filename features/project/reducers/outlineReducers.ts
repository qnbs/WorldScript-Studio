import type { PayloadAction } from '@reduxjs/toolkit';
import type { OutlineSection } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Outline reducer cases extracted from projectSlice.
export const outlineReducers = {
  setOutline: (state: ProjectSliceState, action: PayloadAction<OutlineSection[]>) => {
    state.data.outline = action.payload;
  },
};
