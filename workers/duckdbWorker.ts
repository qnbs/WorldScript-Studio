/// <reference lib="webworker" />
// QNBS-v3: Off-main-thread DuckDB-WASM worker. OPFS persistence with in-memory fallback.
//          Uses duckdb-eh bundle (no SharedArrayBuffer required — no COOP/COEP needed).
//          Message protocol mirrors inference.worker.ts for consistency.

export type DuckDbRequestType = 'INIT' | 'QUERY' | 'EXEC' | 'MIGRATE' | 'SHUTDOWN';

// QNBS-v3: Out-of-band event emitted when OPFS attach fails — no messageId, fires independently.
export interface DuckDbWorkerEvent {
  type: 'OPFS_FALLBACK';
  reason: string;
}

export interface DuckDbRequest {
  messageId: string;
  type: DuckDbRequestType;
  sql?: string | undefined;
  params?: readonly unknown[] | undefined;
}

export interface DuckDbResponse {
  messageId: string;
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
  latencyMs?: number;
}

// QNBS-v3: Lazy module reference — DuckDB bundle is ~2 MB; only load when INIT is received.
let duckdbModule: typeof import('@duckdb/duckdb-wasm') | null = null;
let db: import('@duckdb/duckdb-wasm').AsyncDuckDB | null = null;
let connection: import('@duckdb/duckdb-wasm').AsyncDuckDBConnection | null = null;

async function getDuckDb() {
  if (!duckdbModule) {
    duckdbModule = await import('@duckdb/duckdb-wasm');
  }
  return duckdbModule;
}

// QNBS-v3: Security guard — only process messages from the same origin (mirrors inference.worker.ts).
function isTrustedWorkerMessage(event: MessageEvent): boolean {
  return event.origin === '' || event.origin === globalThis.location?.origin;
}

async function isOPFSSupported(): Promise<boolean> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return false;
    await root.getFileHandle('__duckdb_opfs_test__', { create: true });
    return true;
  } catch {
    return false;
  }
}

// QNBS-v3 (F-09): self-hosted, same-origin DuckDB-WASM assets — copied from the pinned
// @duckdb/duckdb-wasm npm dependency by scripts/copy-duckdb-assets.mjs (predev/prebuild) into
// public/duckdb/. Previously loaded from an unversioned third-party CDN, which was (a) a
// floating "latest" dependency decoupled from the locked npm version, (b) a supply-chain trust
// dependency in an app that markets "offline-first" and "no data is sent to a server", and (c)
// already unreachable under worker-src 'self' blob:' CSP (no CDN allowance) — dead code, not
// just a risk. Absolute path (not relative) so resolution is unambiguous whether constructed
// from the main thread or this nested worker context.
const DUCKDB_ASSET_BASE = `${import.meta.env.BASE_URL}duckdb/`;
const SELF_HOSTED_BUNDLES = {
  mvp: {
    mainModule: `${DUCKDB_ASSET_BASE}duckdb-mvp.wasm`,
    mainWorker: `${DUCKDB_ASSET_BASE}duckdb-browser-mvp.worker.js`,
  },
  eh: {
    mainModule: `${DUCKDB_ASSET_BASE}duckdb-eh.wasm`,
    mainWorker: `${DUCKDB_ASSET_BASE}duckdb-browser-eh.worker.js`,
  },
};

async function initDuckDb(): Promise<void> {
  const { AsyncDuckDB, selectBundle, ConsoleLogger } = await getDuckDb();

  const bundle = await selectBundle(SELF_HOSTED_BUNDLES);
  const logger = new ConsoleLogger();
  // QNBS-v3: bundle.mainWorker can be null for non-browser bundles; guard before constructing Worker.
  if (!bundle.mainWorker) throw new Error('DuckDB bundle has no worker URL');
  const worker = new Worker(bundle.mainWorker);
  const newDb = new AsyncDuckDB(logger, worker);
  await newDb.instantiate(bundle.mainModule);

  // QNBS-v3: OPFS for persistence when available; fall back to in-memory (private browsing, old Safari).
  const useOpfs = await isOPFSSupported();
  if (useOpfs) {
    try {
      const { DuckDBDataProtocol } = await getDuckDb();
      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle('worldscript_analytics.duckdb', {
        create: true,
      });
      await newDb.registerFileHandle(
        'worldscript_analytics.duckdb',
        fileHandle,
        DuckDBDataProtocol.BROWSER_FSACCESS,
        true,
      );
      connection = await newDb.connect();
      await connection.query("ATTACH 'worldscript_analytics.duckdb' AS analytics (TYPE duckdb)");
    } catch (opfsErr) {
      // QNBS-v3: Notify main thread so the hook can set persistence-mode badge in Redux.
      self.postMessage({
        type: 'OPFS_FALLBACK',
        reason: opfsErr instanceof Error ? opfsErr.message : String(opfsErr),
      } satisfies DuckDbWorkerEvent);
      connection = await newDb.connect();
    }
  } else {
    connection = await newDb.connect();
  }

  db = newDb;
}

async function handleQuery(req: DuckDbRequest): Promise<DuckDbResponse> {
  const start = Date.now();
  if (!connection) {
    return { messageId: req.messageId, ok: false, error: 'DuckDB not initialized', latencyMs: 0 };
  }
  try {
    const result = await connection.query(req.sql ?? '');
    const rows = result.toArray().map((row: { toJSON(): Record<string, unknown> }) => row.toJSON());
    return { messageId: req.messageId, ok: true, rows, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      messageId: req.messageId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function handleExec(req: DuckDbRequest): Promise<DuckDbResponse> {
  const start = Date.now();
  if (!connection) {
    return { messageId: req.messageId, ok: false, error: 'DuckDB not initialized', latencyMs: 0 };
  }
  try {
    await connection.query(req.sql ?? '');
    return { messageId: req.messageId, ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      messageId: req.messageId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function handleShutdown(req: DuckDbRequest): Promise<DuckDbResponse> {
  try {
    await connection?.close();
    await db?.terminate();
    connection = null;
    db = null;
    return { messageId: req.messageId, ok: true };
  } catch (err) {
    return {
      messageId: req.messageId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// QNBS-v3: In-flight AbortController map (mirrors inference.worker.ts; DuckDB cancellation via close/reopen).
const abortMap = new Map<string, AbortController>();

self.addEventListener('message', (event: MessageEvent) => {
  if (!isTrustedWorkerMessage(event)) return;

  // QNBS-v3: Check raw type as string before narrowing to DuckDbRequest so WORKER_CANCEL is reachable.
  const raw = event.data as { type?: string; messageId?: string };

  if (raw.type === 'WORKER_CANCEL' && raw.messageId) {
    abortMap.get(raw.messageId)?.abort();
    abortMap.delete(raw.messageId);
    return;
  }

  const req = event.data as DuckDbRequest;

  const controller = new AbortController();
  abortMap.set(req.messageId, controller);

  let task: Promise<DuckDbResponse>;

  switch (req.type) {
    case 'INIT':
      task = initDuckDb()
        .then(() => ({ messageId: req.messageId, ok: true }))
        .catch((err: unknown) => ({
          messageId: req.messageId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      break;
    case 'QUERY':
      task = handleQuery(req);
      break;
    case 'EXEC':
      task = handleExec(req);
      break;
    case 'SHUTDOWN':
      task = handleShutdown(req);
      break;
    default:
      task = Promise.resolve({
        messageId: req.messageId,
        ok: false,
        error: `Unknown request type: ${String(req.type)}`,
      });
  }

  void task.then((response) => {
    abortMap.delete(req.messageId);
    self.postMessage(response);
  });
});
