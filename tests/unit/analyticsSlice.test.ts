import { describe, expect, it } from 'vitest';
import analyticsReducer, {
  type AnalyticsState,
  analyticsActions,
  selectDuckDbStatus,
  selectIsDuckDbReady,
  selectLastSyncAt,
  selectMigrationStatus,
} from '../../features/analytics/analyticsSlice';

const initial: AnalyticsState = {
  duckDbStatus: 'idle',
  duckDbError: null,
  duckDbPersistenceMode: null,
  migrationStatus: 'idle',
  migrationError: null,
  lastSyncAt: null,
};

describe('analyticsSlice reducers', () => {
  it('setDuckDbStatus transitions idle → initializing', () => {
    const state = analyticsReducer(initial, analyticsActions.setDuckDbStatus('initializing'));
    expect(state.duckDbStatus).toBe('initializing');
    expect(state.duckDbError).toBeNull();
  });

  it('setDuckDbStatus clears error when transitioning away from error', () => {
    const withError: AnalyticsState = { ...initial, duckDbStatus: 'error', duckDbError: 'oops' };
    const state = analyticsReducer(withError, analyticsActions.setDuckDbStatus('ready'));
    expect(state.duckDbStatus).toBe('ready');
    expect(state.duckDbError).toBeNull();
  });

  it('setDuckDbError sets status=error and stores message', () => {
    const state = analyticsReducer(initial, analyticsActions.setDuckDbError('init failed'));
    expect(state.duckDbStatus).toBe('error');
    expect(state.duckDbError).toBe('init failed');
  });

  it('setMigrationStatus transitions idle → running', () => {
    const state = analyticsReducer(initial, analyticsActions.setMigrationStatus('running'));
    expect(state.migrationStatus).toBe('running');
    expect(state.migrationError).toBeNull();
  });

  it('setMigrationStatus → done clears migrationError', () => {
    const withErr: AnalyticsState = {
      ...initial,
      migrationStatus: 'error',
      migrationError: 'failed',
    };
    const state = analyticsReducer(withErr, analyticsActions.setMigrationStatus('done'));
    expect(state.migrationStatus).toBe('done');
    expect(state.migrationError).toBeNull();
  });

  it('setMigrationError sets migrationStatus=error', () => {
    const state = analyticsReducer(initial, analyticsActions.setMigrationError('IDB read error'));
    expect(state.migrationStatus).toBe('error');
    expect(state.migrationError).toBe('IDB read error');
  });

  it('setLastSyncAt stores ISO timestamp', () => {
    const ts = '2026-05-20T12:00:00.000Z';
    const state = analyticsReducer(initial, analyticsActions.setLastSyncAt(ts));
    expect(state.lastSyncAt).toBe(ts);
  });
});

describe('analyticsSlice selectors', () => {
  const makeState = (override: Partial<AnalyticsState> = {}) => ({
    analytics: { ...initial, ...override },
  });

  it('selectDuckDbStatus returns current status', () => {
    expect(selectDuckDbStatus(makeState({ duckDbStatus: 'ready' }))).toBe('ready');
  });

  it('selectIsDuckDbReady is true only when status=ready', () => {
    expect(selectIsDuckDbReady(makeState({ duckDbStatus: 'ready' }))).toBe(true);
    expect(selectIsDuckDbReady(makeState({ duckDbStatus: 'initializing' }))).toBe(false);
    expect(selectIsDuckDbReady(makeState({ duckDbStatus: 'error' }))).toBe(false);
  });

  it('selectMigrationStatus returns migrationStatus', () => {
    expect(selectMigrationStatus(makeState({ migrationStatus: 'done' }))).toBe('done');
  });

  it('selectLastSyncAt returns null initially', () => {
    expect(selectLastSyncAt(makeState())).toBeNull();
  });

  it('selectLastSyncAt returns stored timestamp', () => {
    const ts = '2026-05-20T00:00:00.000Z';
    expect(selectLastSyncAt(makeState({ lastSyncAt: ts }))).toBe(ts);
  });
});
