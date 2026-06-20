import type { PayloadAction } from '@reduxjs/toolkit';
import type { WritingGoal, WritingSession } from '../../../types';
import type { ProjectSliceState } from '../projectState';

// QNBS-v3: Writing-analytics reducer cases extracted from projectSlice — sessions + goals.
export const writingAnalyticsReducers = {
  addWritingSession: (state: ProjectSliceState, action: PayloadAction<WritingSession>) => {
    if (!state.data.writingSessions) state.data.writingSessions = [];
    state.data.writingSessions.push(action.payload);
  },
  updateWritingGoal: (
    state: ProjectSliceState,
    action: PayloadAction<{ id: string; changes: Partial<WritingGoal> }>,
  ) => {
    if (!state.data.writingGoals) state.data.writingGoals = [];
    const index = state.data.writingGoals.findIndex((g) => g.id === action.payload.id);
    if (index !== -1) {
      const goal = state.data.writingGoals[index];
      if (goal) {
        Object.assign(goal, action.payload.changes);
      }
    }
  },
};
