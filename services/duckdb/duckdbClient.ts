// QNBS-v3: Singleton proxy for DuckDB analytics — routes through the shared WorkerBus v2 'duckdb'
//          pool (docs/adr/0014-worker-generation-duplication.md migration, superseded by
//          ADR-0015). Public API is unchanged from the v1-backed client (init/query/exec/
//          shutdown/terminate/setOpfsFallbackHandler) so all 5 consumers (useDuckDb.ts,
//          duckdbAnalytics.ts, duckdbMigration.ts, ragVectorMigration.ts, telemetryService.ts)
//          need no changes — only the transport underneath swapped.

import { ensureDuckDbPool, getWorkerBus } from '../workerBusManager';

export type DuckDbRequestType = 'INIT' | 'QUERY' | 'EXEC' | 'SHUTDOWN';

export interface DuckDbResponse {
  messageId: string;
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
  latencyMs?: number;
}

const TASK_TYPE: Record<DuckDbRequestType, string> = {
  INIT: 'db.duckdb.init',
  QUERY: 'db.duckdb.query',
  EXEC: 'db.duckdb.exec',
  SHUTDOWN: 'db.duckdb.shutdown',
};

let messageIdCounter = 0;
function generateMessageId(): string {
  return `duckdb-${Date.now()}-${++messageIdCounter}`;
}

// QNBS-v3: Settable by useDuckDb to surface OPFS fallback state in Redux.
let opfsFallbackCb: ((reason: string) => void) | null = null;

function errorMessage(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'CIRCUIT_OPEN') return 'DuckDB temporarily unavailable (circuit open)';
  return err instanceof Error ? err.message : String(err);
}

async function send(
  type: DuckDbRequestType,
  sql?: string,
  params?: readonly unknown[],
  signal?: AbortSignal,
  isReinitRetry = false,
): Promise<DuckDbResponse> {
  const messageId = generateMessageId();
  const start = Date.now();

  // QNBS-v3: attach synchronously, before the `await` below — v1 set up its abort listener
  //          inside a synchronous Promise executor, so a caller aborting in the same tick as the
  //          call was always caught. This function is async and awaits ensureDuckDbPool() before
  //          a handle exists, which opens a gap; a same-tick abort must not be lost inside it.
  let abortedEarly = signal?.aborted ?? false;
  let handleRef: { cancel: (reason?: string) => void } | undefined;
  const onAbort = (): void => {
    abortedEarly = true;
    handleRef?.cancel('Aborted');
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const bus = await ensureDuckDbPool();
    if (!bus) return { messageId, ok: false, error: 'WorkerBus v2 unavailable' };

    // QNBS-v3: v1 never retried a failed QUERY/EXEC (caller decided) — disabling the bus's
    //          default 2-retry here keeps that behavior instead of silently stacking under
    //          duckdbAnalytics.ts's own withDuckDbRetry() app-level retry
    //          (app/listenerMiddleware.ts).
    const handle = bus.enqueue<
      { sql?: string | undefined; params?: readonly unknown[] | undefined },
      unknown
    >(
      TASK_TYPE[type],
      { sql, params },
      {
        capabilities: ['db.duckdb'],
        retryPolicy: { maxRetries: 0 },
        onProgress: (p) => {
          if (p.stage === 'opfs-fallback') opfsFallbackCb?.(p.message ?? 'OPFS unavailable');
        },
      },
    );
    handleRef = handle;
    if (abortedEarly) handle.cancel('Aborted');

    try {
      const raw = await handle.result;
      const latencyMs = Date.now() - start;
      if (type === 'QUERY') {
        return { messageId, ok: true, rows: raw as Record<string, unknown>[], latencyMs };
      }
      return { messageId, ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (signal?.aborted) return { messageId, ok: false, error: 'Aborted', latencyMs };
      const message = errorMessage(err);
      // QNBS-v3: [The duckdb pool's worker can idle-terminate (minWorkers:0) or crash-restart; a
      //          freshly spawned worker's module state has no `connection` until INIT runs again.
      //          Transparently re-init once and retry, instead of surfacing a confusing "not
      //          initialized" error for what looks like a routine idle-timeout respawn.]
      if (
        !isReinitRetry &&
        type !== 'INIT' &&
        type !== 'SHUTDOWN' &&
        message === 'DuckDB not initialized'
      ) {
        const reinit = await send('INIT', undefined, undefined, signal, true);
        if (reinit.ok) {
          return send(type, sql, params, signal, true);
        }
      }
      return { messageId, ok: false, error: message, latencyMs };
    }
  } finally {
    // QNBS-v3: [{once:true} only self-removes once the listener actually fires — a caller that
    //          reuses one AbortSignal across many queries (a common hook/thunk pattern) would
    //          otherwise accumulate one listener per call for the signal's whole lifetime.]
    signal?.removeEventListener('abort', onAbort);
  }
}

export const duckdbClient = {
  /** Boot DuckDB, create OPFS or in-memory DB, apply DDL. */
  init(signal?: AbortSignal): Promise<DuckDbResponse> {
    return send('INIT', undefined, undefined, signal);
  },

  /** Run a SELECT — returns rows. */
  query(sql: string, params?: readonly unknown[], signal?: AbortSignal): Promise<DuckDbResponse> {
    return send('QUERY', sql, params, signal);
  },

  /** Run a DDL / DML statement — no rows returned. */
  exec(sql: string, params?: readonly unknown[], signal?: AbortSignal): Promise<DuckDbResponse> {
    return send('EXEC', sql, params, signal);
  },

  /** Gracefully terminate the worker. */
  shutdown(signal?: AbortSignal): Promise<DuckDbResponse> {
    return send('SHUTDOWN', undefined, undefined, signal);
  },

  /**
   * Terminate the DuckDB pool immediately (no flush).
   * QNBS-v3: scoped via WorkerBus.terminatePool('duckdb') so this doesn't tear down the shared
   * bus's other pools (inference/webllm/plugin) — bus.shutdown() would kill all of them.
   */
  terminate(): void {
    const bus = getWorkerBus();
    void bus?.terminatePool('duckdb');
  },

  /** Register a callback invoked when DuckDB falls back to in-memory (OPFS unavailable). */
  setOpfsFallbackHandler(cb: ((reason: string) => void) | null): void {
    opfsFallbackCb = cb;
  },
};
