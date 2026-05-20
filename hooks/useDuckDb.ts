// QNBS-v3: Low-level hook that exposes DuckDB query/exec/isReady to React components.
//          Components should prefer useAnalytics (high-level) over this hook directly.

import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { analyticsActions, selectDuckDbStatus } from '../features/analytics/analyticsSlice';
import { selectEnableDuckDbAnalytics } from '../features/featureFlags/featureFlagsSlice';
import { duckdbClient } from '../services/duckdb/duckdbClient';
import { DUCKDB_DDL } from '../services/duckdb/duckdbSchema';

export function useDuckDb() {
  const dispatch = useAppDispatch();
  const isEnabled = useAppSelector(selectEnableDuckDbAnalytics);
  const status = useAppSelector(selectDuckDbStatus);

  useEffect(() => {
    if (!isEnabled || status !== 'idle') return;

    let cancelled = false;
    const controller = new AbortController();

    dispatch(analyticsActions.setDuckDbStatus('initializing'));

    void (async () => {
      const initRes = await duckdbClient.init(controller.signal);
      if (cancelled) return;

      if (!initRes.ok) {
        dispatch(analyticsActions.setDuckDbError(initRes.error ?? 'DuckDB init failed'));
        return;
      }

      // Apply schema DDL after worker boots
      const ddlRes = await duckdbClient.exec(DUCKDB_DDL, undefined, controller.signal);
      if (cancelled) return;

      if (!ddlRes.ok) {
        dispatch(analyticsActions.setDuckDbError(ddlRes.error ?? 'DuckDB schema DDL failed'));
        return;
      }

      dispatch(analyticsActions.setDuckDbStatus('ready'));
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isEnabled, status, dispatch]);

  const isReady = status === 'ready';

  const queryAsync = useCallback(
    async (sql: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> => {
      if (!isReady) return [];
      const res = await duckdbClient.query(sql, undefined, signal);
      return res.ok ? (res.rows ?? []) : [];
    },
    [isReady],
  );

  const execAsync = useCallback(
    async (sql: string, signal?: AbortSignal): Promise<boolean> => {
      if (!isReady) return false;
      const res = await duckdbClient.exec(sql, undefined, signal);
      return res.ok;
    },
    [isReady],
  );

  return { isReady, queryAsync, execAsync, status };
}
