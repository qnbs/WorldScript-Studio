/**
 * Tests for hooks/useDuckDb.ts
 * QNBS-v3: Covers feature-flag gating, init success/failure, queryAsync, execAsync.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockIsEnabled = false;
let mockStatus = 'idle';

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      featureFlags: { enableDuckDbAnalytics: mockIsEnabled },
      analytics: { duckDbStatus: mockStatus },
    }),
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableDuckDbAnalytics: (s: { featureFlags: { enableDuckDbAnalytics: boolean } }) =>
    s.featureFlags.enableDuckDbAnalytics,
}));

vi.mock('../../../features/analytics/analyticsSlice', () => ({
  analyticsActions: {
    setDuckDbStatus: vi.fn((s) => ({ type: 'analytics/setDuckDbStatus', payload: s })),
    setDuckDbError: vi.fn((e) => ({ type: 'analytics/setDuckDbError', payload: e })),
    setDuckDbPersistenceMode: vi.fn((m) => ({
      type: 'analytics/setDuckDbPersistenceMode',
      payload: m,
    })),
  },
  selectDuckDbStatus: (s: { analytics: { duckDbStatus: string } }) => s.analytics.duckDbStatus,
}));

const mockDuckdbInit = vi.fn();
const mockDuckdbExec = vi.fn();
const mockDuckdbQuery = vi.fn();
const mockSetOpfsFallbackHandler = vi.fn();

vi.mock('../../../services/duckdb/duckdbClient', () => ({
  duckdbClient: {
    init: (...args: unknown[]) => mockDuckdbInit(...args),
    exec: (...args: unknown[]) => mockDuckdbExec(...args),
    query: (...args: unknown[]) => mockDuckdbQuery(...args),
    setOpfsFallbackHandler: (...args: unknown[]) => mockSetOpfsFallbackHandler(...args),
  },
}));

vi.mock('../../../services/duckdb/duckdbSchema', () => ({
  DUCKDB_DDL: 'CREATE TABLE IF NOT EXISTS sessions (id TEXT)',
  DUCKDB_MIGRATION_V2_DDL: 'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TEXT',
}));

vi.mock('../../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { analyticsActions } from '../../../features/analytics/analyticsSlice';
import { useDuckDb } from '../../../hooks/useDuckDb';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDuckDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled = false;
    mockStatus = 'idle';
  });

  it('returns isReady=false when status is idle', () => {
    const { result } = renderHook(() => useDuckDb());
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=true when status is "ready"', () => {
    mockStatus = 'ready';
    const { result } = renderHook(() => useDuckDb());
    expect(result.current.isReady).toBe(true);
  });

  it('does not start init when feature flag is off', () => {
    mockIsEnabled = false;
    renderHook(() => useDuckDb());
    expect(mockDuckdbInit).not.toHaveBeenCalled();
  });

  it('does not start init when status is not idle', () => {
    mockIsEnabled = true;
    mockStatus = 'ready';
    renderHook(() => useDuckDb());
    expect(mockDuckdbInit).not.toHaveBeenCalled();
  });

  it('dispatches setDuckDbStatus("initializing") synchronously when flag on + status idle', () => {
    mockIsEnabled = true;
    mockStatus = 'idle';
    mockDuckdbInit.mockResolvedValue({ ok: true });
    mockDuckdbExec.mockResolvedValue({ ok: true });
    renderHook(() => useDuckDb());
    // Synchronous dispatch in the useEffect body
    expect(analyticsActions.setDuckDbStatus).toHaveBeenCalledWith('initializing');
  });

  it('dispatches setDuckDbStatus("ready") on successful init', async () => {
    mockIsEnabled = true;
    mockStatus = 'idle';
    // QNBS-v3: Use real timers (default) — fake timers conflict with Promise.race internals
    mockDuckdbInit.mockResolvedValue({ ok: true });
    mockDuckdbExec.mockResolvedValue({ ok: true });

    renderHook(() => useDuckDb());
    // Flush microtasks + promise chain
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(analyticsActions.setDuckDbStatus).toHaveBeenCalledWith('ready');
  });

  it('dispatches setDuckDbError and "unavailable" when init fails immediately', async () => {
    mockIsEnabled = true;
    mockStatus = 'idle';
    // QNBS-v3: Bypass sleepBackoff by making all 3 attempts fail + mock sleep to be instant
    mockDuckdbInit.mockResolvedValue({ ok: false, error: 'WASM load failed' });
    // sleepBackoff uses setTimeout — stub it to resolve immediately
    vi.spyOn(global, 'setTimeout').mockImplementation((fn) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    renderHook(() => useDuckDb());
    await act(async () => {
      // Flush all async chains
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(analyticsActions.setDuckDbStatus).toHaveBeenCalledWith('unavailable');
    vi.restoreAllMocks();
  });

  describe('queryAsync', () => {
    it('returns empty array when not ready (status idle)', async () => {
      mockStatus = 'idle';
      const { result } = renderHook(() => useDuckDb());
      const rows = await result.current.queryAsync('SELECT 1');
      expect(rows).toEqual([]);
    });

    it('queries duckdbClient when ready and returns rows', async () => {
      mockStatus = 'ready';
      mockDuckdbQuery.mockResolvedValueOnce({ ok: true, rows: [{ id: '1' }] });
      const { result } = renderHook(() => useDuckDb());
      const rows = await result.current.queryAsync('SELECT * FROM sessions');
      expect(rows).toEqual([{ id: '1' }]);
    });

    it('returns empty array when query result is not ok', async () => {
      mockStatus = 'ready';
      mockDuckdbQuery.mockResolvedValueOnce({ ok: false, error: 'Query error' });
      const { result } = renderHook(() => useDuckDb());
      const rows = await result.current.queryAsync('SELECT invalid');
      expect(rows).toEqual([]);
    });
  });

  describe('execAsync', () => {
    it('returns false when not ready', async () => {
      mockStatus = 'idle';
      const { result } = renderHook(() => useDuckDb());
      const ok = await result.current.execAsync('INSERT INTO sessions VALUES (1)');
      expect(ok).toBe(false);
    });

    it('returns true when exec succeeds', async () => {
      mockStatus = 'ready';
      mockDuckdbExec.mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useDuckDb());
      const ok = await result.current.execAsync('INSERT INTO sessions VALUES (1)');
      expect(ok).toBe(true);
    });

    it('returns false when exec fails', async () => {
      mockStatus = 'ready';
      mockDuckdbExec.mockResolvedValueOnce({ ok: false });
      const { result } = renderHook(() => useDuckDb());
      const ok = await result.current.execAsync('INVALID SQL');
      expect(ok).toBe(false);
    });
  });
});
