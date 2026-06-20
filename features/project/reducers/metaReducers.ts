import type { PayloadAction } from '@reduxjs/toolkit';
import { charactersAdapter, worldsAdapter } from '../adapters';
import { initialState, type ProjectSliceState } from '../projectState';

// QNBS-v3: Project-meta reducer cases extracted from projectSlice — title/logline/goals/reset.
export const metaReducers = {
  updateTitle: (state: ProjectSliceState, action: PayloadAction<string>) => {
    state.data.title = action.payload;
  },
  updateLogline: (state: ProjectSliceState, action: PayloadAction<string>) => {
    state.data.logline = action.payload;
  },
  updateProjectGoal: (
    state: ProjectSliceState,
    action: PayloadAction<{
      key: 'totalWordCount' | 'targetDate';
      value: number | string | null;
    }>,
  ) => {
    if (state.data.projectGoals) {
      if (action.payload.key === 'totalWordCount') {
        state.data.projectGoals.totalWordCount = action.payload.value as number;
      } else if (action.payload.key === 'targetDate') {
        state.data.projectGoals.targetDate = action.payload.value as string | null;
      }
    }
  },
  resetProject: (
    state: ProjectSliceState,
    // QNBS-v3: chapter1Title is required and supplied localized by callers (t('initialProject.chapter1'))
    // — no hardcoded English fallback in the reducer, which can't reach the i18n context.
    action: PayloadAction<{ title: string; logline: string; chapter1Title: string }>,
  ) => {
    state.data = {
      ...initialState.data,
      title: action.payload.title,
      logline: action.payload.logline,
      characters: charactersAdapter.getInitialState(),
      worlds: worldsAdapter.getInitialState(),
      manuscript: [
        {
          id: `sec-${Date.now()}`,
          title: action.payload.chapter1Title,
          content: '',
        },
      ],
      binderNodes: [],
    };
  },
};
