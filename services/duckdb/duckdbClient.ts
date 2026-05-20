// QNBS-v3: Singleton proxy for the DuckDB-WASM worker.
//          Exposes typed query/exec/init/shutdown helpers with AbortSignal cancellation.
//          Worker is instantiated lazily on first call to init().

import type { DuckDbRequest, DuckDbRequestType, DuckDbResponse } from '../../workers/duckdbWorker';

let worker: Worker | null = null;
const pendingResolvers = new Map<string, (res: DuckDbResponse) => void>();
let messageIdCounter = 0;

function generateMessageId(): string {
  return `duckdb-${Date.now()}-${++messageIdCounter}`;
}

function getWorker(): Worker {
  if (!worker) {
    // QNBS-v3: Vite import.meta.url pattern — same as inference.worker.ts.
    worker = new Worker(new URL('../../workers/duckdbWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<DuckDbResponse>) => {
      const { messageId } = event.data;
      const resolve = pendingResolvers.get(messageId);
      if (resolve) {
        pendingResolvers.delete(messageId);
        resolve(event.data);
      }
    });
    worker.addEventListener('error', (event) => {
      // Reject all pending promises on fatal worker error
      const error = event.message ?? 'DuckDB worker crashed';
      for (const [id, resolve] of pendingResolvers) {
        resolve({ messageId: id, ok: false, error });
      }
      pendingResolvers.clear();
      worker = null;
    });
  }
  return worker;
}

function send(
  type: DuckDbRequestType,
  sql?: string,
  params?: readonly unknown[],
  signal?: AbortSignal,
): Promise<DuckDbResponse> {
  const messageId = generateMessageId();
  const w = getWorker();

  return new Promise<DuckDbResponse>((resolve) => {
    pendingResolvers.set(messageId, resolve);

    if (signal) {
      signal.addEventListener('abort', () => {
        w.postMessage({ type: 'WORKER_CANCEL', messageId });
        pendingResolvers.delete(messageId);
        resolve({ messageId, ok: false, error: 'Aborted' });
      });
    }

    const req: DuckDbRequest = { messageId, type, sql, params };
    w.postMessage(req);
  });
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

  /** Terminate the worker immediately (no flush). */
  terminate(): void {
    worker?.terminate();
    worker = null;
    pendingResolvers.clear();
  },
};
