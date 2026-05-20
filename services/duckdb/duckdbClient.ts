// QNBS-v3: Singleton proxy for the DuckDB-WASM worker.
//          Exposes typed query/exec/init/shutdown helpers with AbortSignal cancellation.
//          Worker is instantiated lazily on first call to init().

import type {
  DuckDbRequest,
  DuckDbRequestType,
  DuckDbResponse,
  DuckDbWorkerEvent,
} from '../../workers/duckdbWorker';

let worker: Worker | null = null;
const pendingResolvers = new Map<string, (res: DuckDbResponse) => void>();
let messageIdCounter = 0;
// QNBS-v3: Settable by useDuckDb to surface OPFS fallback state in Redux.
let opfsFallbackCb: ((reason: string) => void) | null = null;

function generateMessageId(): string {
  return `duckdb-${Date.now()}-${++messageIdCounter}`;
}

function getWorker(): Worker {
  if (!worker) {
    // QNBS-v3: Vite import.meta.url pattern — same as inference.worker.ts.
    worker = new Worker(new URL('../../workers/duckdbWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as DuckDbResponse | DuckDbWorkerEvent;
      // QNBS-v3: OPFS_FALLBACK is out-of-band — no messageId resolver to call.
      if ((data as DuckDbWorkerEvent).type === 'OPFS_FALLBACK') {
        opfsFallbackCb?.((data as DuckDbWorkerEvent).reason);
        return;
      }
      const { messageId } = data as DuckDbResponse;
      const resolve = pendingResolvers.get(messageId);
      if (resolve) {
        pendingResolvers.delete(messageId);
        resolve(data as DuckDbResponse);
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

  /** Register a callback invoked when the worker falls back to in-memory (OPFS unavailable). */
  setOpfsFallbackHandler(cb: ((reason: string) => void) | null): void {
    opfsFallbackCb = cb;
  },
};
