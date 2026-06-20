import type { PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { StorySection } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Manuscript-section reducer cases extracted from projectSlice.
export const manuscriptReducers = {
  setManuscript: (state: ProjectSliceState, action: PayloadAction<StorySection[]>) => {
    state.data.manuscript = action.payload;
  },
  updateManuscriptSection: (
    state: ProjectSliceState,
    action: PayloadAction<{ id: string; changes: Partial<StorySection> }>,
  ) => {
    const index = state.data.manuscript.findIndex((s) => s.id === action.payload.id);
    if (index !== -1) {
      const section = state.data.manuscript[index];
      if (section) {
        Object.assign(section, action.payload.changes);
      }
    }
  },
  addManuscriptSection: (
    state: ProjectSliceState,
    action: PayloadAction<{ title: string; index?: number }>,
  ) => {
    const newSection: StorySection = {
      id: uuidv4(),
      title: action.payload.title,
      content: '',
    };
    if (action.payload.index !== undefined) {
      state.data.manuscript.splice(action.payload.index, 0, newSection);
    } else {
      state.data.manuscript.push(newSection);
    }
  },
  deleteManuscriptSection: (state: ProjectSliceState, action: PayloadAction<string>) => {
    state.data.manuscript = state.data.manuscript.filter((s) => s.id !== action.payload);
  },
  // QNBS-v3: Tastatur-/Button-Reihenfolge im Scene Board pro Akt — ohne DnD-only-Zwang.
  moveManuscriptSectionWithinAct: (
    state: ProjectSliceState,
    action: PayloadAction<{ id: string; direction: 'up' | 'down' }>,
  ) => {
    const { id, direction } = action.payload;
    const ms = state.data.manuscript;
    const idx = ms.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const act = ms[idx]?.act ?? 1;
    const indicesInAct: number[] = [];
    for (let i = 0; i < ms.length; i++) {
      const s = ms[i];
      if (s && (s.act ?? 1) === act) indicesInAct.push(i);
    }
    const posInAct = indicesInAct.indexOf(idx);
    if (posInAct === -1) return;
    const targetPosInAct = posInAct + (direction === 'up' ? -1 : 1);
    if (targetPosInAct < 0 || targetPosInAct >= indicesInAct.length) return;
    const j = indicesInAct[targetPosInAct];
    if (j === undefined) return;
    const next = [...ms];
    const a = next[idx];
    const b = next[j];
    if (!a || !b) return;
    next[idx] = b;
    next[j] = a;
    state.data.manuscript = next;
  },
};
