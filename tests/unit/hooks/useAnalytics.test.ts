/**
 * Tests for hooks/useAnalytics.ts
 * QNBS-v3: Covers feature-flag gating, DuckDB unavailability warning, data fetch, abort on cleanup.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockIsEnabled = false;
let mockIsReady = false;
let mockDuckDbStatus: string = 'idle';
let mockDuckDbError: string | null = null;
let mockProjectId = 'proj-1';

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      featureFlags: { enableDuckDbAnalytics: mockIsEnabled },
      analytics: {
        duckDbStatus: mockDuckDbStatus,
        duckDbError: mockDuckDbError,
        isDuckDbReady: mockIsReady,
      },
      project: { present: { data: { id: mockProjectId, manuscript: [] } } },
    }),
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableDuckDbAnalytics: (s: { featureFlags: { enableDuckDbAnalytics: boolean } }) =>
    s.featureFlags.enableDuckDbAnalytics,
}));

vi.mock('../../../features/analytics/analyticsSlice', () => ({
  selectIsDuckDbReady: (s: { analytics: { isDuckDbReady: boolean } }) => s.analytics.isDuckDbReady,
  selectDuckDbStatus: (s: { analytics: { duckDbStatus: string } }) => s.analytics.duckDbStatus,
  selectDuckDbError: (s: { analytics: { duckDbError: string | null } }) => s.analytics.duckDbError,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: (s: { project: { present: { data: { id: string } } } }) =>
    s.project.present.data,
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((p) => ({ type: 'status/addNotification', payload: p })),
  },
}));

const mockQueryDailyProgress = vi.fn();
const mockQueryWeeklyProgress = vi.fn();
const mockQueryStreak = vi.fn();
const mockQuerySceneOverlaps = vi.fn();

vi.mock('../../../services/duckdb/duckdbAnalytics', () => ({
  queryDailyProgress: (...args: unknown[]) => mockQueryDailyProgress(...args),
  queryWeeklyProgress: (...args: unknown[]) => mockQueryWeeklyProgress(...args),
  queryStreak: (...args: unknown[]) => mockQueryStreak(...args),
  querySceneOverlaps: (...args: unknown[]) => mockQuerySceneOverlaps(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { statusActions } from '../../../features/status/statusSlice';
import { useAnalytics } from '../../../hooks/useAnalytics';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled = false;
    mockIsReady = false;
    mockDuckDbStatus = 'idle';
    mockDuckDbError = null;
    mockProjectId = 'proj-1';

    mockQueryDailyProgress.mockResolvedValue([]);
    mockQueryWeeklyProgress.mockResolvedValue([]);
    mockQueryStreak.mockResolvedValue({ current: 0, longest: 0 });
    mockQuerySceneOverlaps.mockResolvedValue([]);
  });

  describe('flag disabled', () => {
    it('returns isEnabled=false and no data when flag is off', () => {
      mockIsEnabled = false;
      const { result } = renderHook(() => useAnalytics());
      expect(result.current.isEnabled).toBe(false);
      expect(result.current.dailyProgress).toBeUndefined();
      expect(result.current.weeklyProgress).toBeUndefined();
      expect(result.current.streak).toBeUndefined();
    });

    it('does not call DuckDB queries when flag is off', () => {
      mockIsEnabled = false;
      renderHook(() => useAnalytics());
      expect(mockQueryDailyProgress).not.toHaveBeenCalled();
    });
  });

  describe('flag enabled, DuckDB not ready', () => {
    it('sets isEnabled=true but keeps data undefined while DuckDB is not ready', () => {
      mockIsEnabled = true;
      mockIsReady = false;
      const { result } = renderHook(() => useAnalytics());
      expect(result.current.isEnabled).toBe(true);
      expect(result.current.dailyProgress).toBeUndefined();
    });
  });

  describe('flag enabled, DuckDB ready', () => {
    it('fetches all 4 queries when enabled + ready', async () => {
      mockIsEnabled = true;
      mockIsReady = true;

      mockQueryDailyProgress.mockResolvedValue([{ date: '2026-01-01', words: 100 }]);
      mockQueryWeeklyProgress.mockResolvedValue([{ week: '2026-W01', words: 500 }]);
      mockQueryStreak.mockResolvedValue({ current: 3, longest: 7 });
      mockQuerySceneOverlaps.mockResolvedValue([]);

      let _result: ReturnType<typeof useAnalytics>;
      await act(async () => {
        const r = renderHook(() => useAnalytics());
        _result = r.result.current;
        // Wait a tick for async effects
        await Promise.resolve();
      });

      expect(mockQueryDailyProgress).toHaveBeenCalledWith('proj-1', 30, expect.any(AbortSignal));
      expect(mockQueryWeeklyProgress).toHaveBeenCalledWith('proj-1', 12, expect.any(AbortSignal));
      expect(mockQueryStreak).toHaveBeenCalledWith('proj-1', expect.any(AbortSignal));
      expect(mockQuerySceneOverlaps).toHaveBeenCalledWith('proj-1', expect.any(AbortSignal));
    });

    it('sets data after queries resolve', async () => {
      mockIsEnabled = true;
      mockIsReady = true;

      const dailyData = [{ date: '2026-01-01', words: 200 }];
      mockQueryDailyProgress.mockResolvedValue(dailyData);
      mockQueryWeeklyProgress.mockResolvedValue([]);
      mockQueryStreak.mockResolvedValue({ current: 5, longest: 10 });
      mockQuerySceneOverlaps.mockResolvedValue([]);

      const { result } = renderHook(() => useAnalytics());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(result.current.dailyProgress).toEqual(dailyData);
      expect(result.current.streak?.current).toBe(5);
    });
  });

  describe('DuckDB unavailability', () => {
    it('dispatches addNotification toast when DuckDB status is "error"', () => {
      mockIsEnabled = true;
      mockDuckDbStatus = 'error';
      mockDuckDbError = 'init failed';

      renderHook(() => useAnalytics());

      expect(statusActions.addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', title: 'Analytics unavailable' }),
      );
    });

    it('sets duckDbUnavailable=true when status is "error"', () => {
      mockIsEnabled = true;
      mockDuckDbStatus = 'error';

      const { result } = renderHook(() => useAnalytics());
      expect(result.current.duckDbUnavailable).toBe(true);
    });

    it('does not dispatch toast when flag is disabled', () => {
      mockIsEnabled = false;
      mockDuckDbStatus = 'error';

      renderHook(() => useAnalytics());
      expect(statusActions.addNotification).not.toHaveBeenCalled();
    });

    it('includes DuckDB error message in notification when available', () => {
      mockIsEnabled = true;
      mockDuckDbStatus = 'unavailable';
      mockDuckDbError = 'OPFS not supported';

      renderHook(() => useAnalytics());

      expect(statusActions.addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('OPFS not supported'),
        }),
      );
    });
  });
});
