import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// QNBS-v3: 'unavailable' = all retries exhausted; feature silently disabled for this session.
export type DuckDbStatus = 'idle' | 'initializing' | 'ready' | 'error' | 'unavailable';
export type MigrationStatus = 'idle' | 'running' | 'done' | 'error';
export type DuckDbPersistenceMode = 'opfs' | 'memory' | null;

export interface AnalyticsState {
  duckDbStatus: DuckDbStatus;
  duckDbError: string | null;
  // QNBS-v3: 'memory' when OPFS attach failed — analytics won't persist across page reloads.
  duckDbPersistenceMode: DuckDbPersistenceMode;
  migrationStatus: MigrationStatus;
  migrationError: string | null;
  lastSyncAt: string | null;
}

const initialState: AnalyticsState = {
  duckDbStatus: 'idle',
  duckDbError: null,
  duckDbPersistenceMode: null,
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
      // Preserve error message on 'unavailable' so it remains visible in debug/settings
      if (action.payload !== 'error' && action.payload !== 'unavailable') {
        state.duckDbError = null;
      }
    },
    setDuckDbError(state, action: PayloadAction<string>) {
      state.duckDbStatus = 'error';
      state.duckDbError = action.payload;
    },
    setDuckDbPersistenceMode(state, action: PayloadAction<DuckDbPersistenceMode>) {
      state.duckDbPersistenceMode = action.payload;
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
export const selectDuckDbPersistenceMode = (state: { analytics: AnalyticsState }) =>
  state.analytics.duckDbPersistenceMode;
export const selectMigrationStatus = (state: { analytics: AnalyticsState }) =>
  state.analytics.migrationStatus;
export const selectLastSyncAt = (state: { analytics: AnalyticsState }) =>
  state.analytics.lastSyncAt;
export const selectIsDuckDbReady = (state: { analytics: AnalyticsState }) =>
  state.analytics.duckDbStatus === 'ready';

export default analyticsSlice.reducer;
