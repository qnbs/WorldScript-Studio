// QNBS-v3: Low-level hook that exposes DuckDB query/exec/isReady to React components.
//          Components should prefer useAnalytics (high-level) over this hook directly.

import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { analyticsActions, selectDuckDbStatus } from '../features/analytics/analyticsSlice';
import { selectEnableDuckDbAnalytics } from '../features/featureFlags/featureFlagsSlice';
import { duckdbClient } from '../services/duckdb/duckdbClient';
import { DUCKDB_DDL } from '../services/duckdb/duckdbSchema';
import { logger } from '../services/logger';

const MAX_INIT_ATTEMPTS = 3;
const INIT_TIMEOUT_MS = 30_000;

/** Race a promise against a timeout; clear the timeout when the signal fires. */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string, signal?: AbortSignal): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      const t = setTimeout(() => rej(new Error(msg)), ms);
      signal?.addEventListener('abort', () => clearTimeout(t), { once: true });
    }),
  ]);
}

export function useDuckDb() {
  const dispatch = useAppDispatch();
  const isEnabled = useAppSelector(selectEnableDuckDbAnalytics);
  const status = useAppSelector(selectDuckDbStatus);

  useEffect(() => {
    if (!isEnabled || status !== 'idle') return;

    let cancelled = false;
    const controller = new AbortController();

    dispatch(analyticsActions.setDuckDbStatus('initializing'));

    // QNBS-v3: Relay OPFS fallback to Redux so Settings can show an in-memory badge.
    duckdbClient.setOpfsFallbackHandler((reason) => {
      if (!cancelled) {
        dispatch(analyticsActions.setDuckDbPersistenceMode('memory'));
        logger.warn('DuckDB OPFS unavailable — analytics will not persist across reloads:', reason);
      }
    });

    void (async () => {
      for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
        if (cancelled) return;
        try {
          const initRes = await withTimeout(
            duckdbClient.init(controller.signal),
            INIT_TIMEOUT_MS,
            `DuckDB init timed out after ${INIT_TIMEOUT_MS / 1000}s`,
            controller.signal,
          );
          if (cancelled) return;
          if (!initRes.ok) throw new Error(initRes.error ?? 'DuckDB init failed');

          // Apply schema DDL after worker boots
          const ddlRes = await duckdbClient.exec(DUCKDB_DDL, undefined, controller.signal);
          if (cancelled) return;
          if (!ddlRes.ok) throw new Error(ddlRes.error ?? 'DuckDB schema DDL failed');

          dispatch(analyticsActions.setDuckDbStatus('ready'));
          return; // success
        } catch (err) {
          if (cancelled) return;
          logger.warn(`DuckDB init attempt ${attempt}/${MAX_INIT_ATTEMPTS} failed:`, err);
          if (attempt < MAX_INIT_ATTEMPTS) {
            // QNBS-v3: Exponential backoff (1 s, 2 s) with abort-safe sleep.
            const backoffMs = 1000 * 2 ** (attempt - 1);
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, backoffMs);
              controller.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(t);
                  resolve();
                },
                { once: true },
              );
            });
          } else {
            // QNBS-v3: All retries exhausted — mark 'unavailable' so callers degrade gracefully.
            dispatch(
              analyticsActions.setDuckDbError(
                err instanceof Error ? err.message : 'DuckDB init failed after all retries',
              ),
            );
            dispatch(analyticsActions.setDuckDbStatus('unavailable'));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      duckdbClient.setOpfsFallbackHandler(null);
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
