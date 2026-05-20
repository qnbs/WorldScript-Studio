import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type DuckDbStatus = 'idle' | 'initializing' | 'ready' | 'error';
export type MigrationStatus = 'idle' | 'running' | 'done' | 'error';

export interface AnalyticsState {
  duckDbStatus: DuckDbStatus;
  duckDbError: string | null;
  migrationStatus: MigrationStatus;
  migrationError: string | null;
  lastSyncAt: string | null;
}

const initialState: AnalyticsState = {
  duckDbStatus: 'idle',
  duckDbError: null,
  migrationStatus: 'idle',
  migrationError: null,
  lastSyncAt: null,
};

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {
    setDuckDbStatus(state, action: PayloadAction<DuckDbStatus>) {
      state.duckDbStatus = action.payload;
      if (action.payload !== 'error') {
        state.duckDbError = null;
      }
    },
    setDuckDbError(state, action: PayloadAction<string>) {
      state.duckDbStatus = 'error';
      state.duckDbError = action.payload;
    },
    setMigrationStatus(state, action: PayloadAction<MigrationStatus>) {
      state.migrationStatus = action.payload;
      if (action.payload !== 'error') {
        state.migrationError = null;
      }
    },
    setMigrationError(state, action: PayloadAction<string>) {
      state.migrationStatus = 'error';
      state.migrationError = action.payload;
    },
    setLastSyncAt(state, action: PayloadAction<string>) {
      state.lastSyncAt = action.payload;
    },
  },
});

export const analyticsActions = analyticsSlice.actions;

export const selectDuckDbStatus = (state: { analytics: AnalyticsState }) =>
  state.analytics.duckDbStatus;
export const selectDuckDbError = (state: { analytics: AnalyticsState }) =>
  state.analytics.duckDbError;
export const selectMigrationStatus = (state: { analytics: AnalyticsState }) =>
  state.analytics.migrationStatus;
export const selectLastSyncAt = (state: { analytics: AnalyticsState }) =>
  state.analytics.lastSyncAt;
export const selectIsDuckDbReady = (state: { analytics: AnalyticsState }) =>
  state.analytics.duckDbStatus === 'ready';

export default analyticsSlice.reducer;
