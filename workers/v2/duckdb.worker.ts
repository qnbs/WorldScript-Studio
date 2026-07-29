/// <reference lib="webworker" />
// QNBS-v3: WorkerBus v2 DuckDB worker. Wraps legacy duckdbWorker.ts logic
//          in the typed bootstrap protocol.

import {
  registerTaskHandler,
  type WorkerHandlerContext,
} from '../../packages/worker-bus/src/workerBootstrap';

let duckdbModule: typeof import('@duckdb/duckdb-wasm') | null = null;
let db: import('@duckdb/duckdb-wasm').AsyncDuckDB | null = null;
let connection: import('@duckdb/duckdb-wasm').AsyncDuckDBConnection | null = null;

async function getDuckDb() {
  if (!duckdbModule) {
    duckdbModule = await import('@duckdb/duckdb-wasm');
  }
  return duckdbModule;
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

// QNBS-v3 (F-09): self-hosted, same-origin DuckDB-WASM assets — see workers/duckdbWorker.ts for the full rationale (unpinned CDN URL, supply-chain trust, already CSP-dead code).
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

// QNBS-v3: [Exported for tests/unit/duckdbWorkerHandler.test.ts to verify real handler logic without a live worker.]
export async function initDuckDb(
  emitProgress?: (stage: string, progress: number, message?: string) => void,
): Promise<void> {
  const { AsyncDuckDB, selectBundle, ConsoleLogger } = await getDuckDb();

  const bundle = await selectBundle(SELF_HOSTED_BUNDLES);
  const logger = new ConsoleLogger();
  if (!bundle.mainWorker) throw new Error('DuckDB bundle has no worker URL');
  const worker = new Worker(bundle.mainWorker);
  const newDb = new AsyncDuckDB(logger, worker);
  await newDb.instantiate(bundle.mainModule);

  const useOpfs = await isOPFSSupported();
  if (useOpfs) {
    // QNBS-v3: [Tracked separately from `connection` so a failed ATTACH can close this partial connection instead of leaking it.]
    let opfsConnection: import('@duckdb/duckdb-wasm').AsyncDuckDBConnection | null = null;
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
      opfsConnection = await newDb.connect();
      await opfsConnection.query(
        "ATTACH 'worldscript_analytics.duckdb' AS analytics (TYPE duckdb)",
      );
      connection = opfsConnection;
    } catch (opfsErr) {
      // QNBS-v3: [Cleanup is best-effort — a rejecting close() must not block the fallback below or replace the original OPFS error.]
      try {
        await opfsConnection?.close();
      } catch (closeErr) {
        console.warn('[duckdb.worker] Failed to close partial OPFS connection', closeErr);
      }
      // QNBS-v3: [No bare postMessage from inside a task handler — OPFS-unavailable is surfaced via the progress channel duckdbClient's INIT adapter listens on instead.]
      emitProgress?.(
        'opfs-fallback',
        1,
        opfsErr instanceof Error ? opfsErr.message : String(opfsErr),
      );
      connection = await newDb.connect();
    }
  } else {
    connection = await newDb.connect();
  }

  db = newDb;
}

export async function handleQuery(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload } = ctx;
  const req = payload as { sql?: string };
  if (!connection) throw new Error('DuckDB not initialized');
  const result = await connection.query(req.sql ?? '');
  return result.toArray().map((row: { toJSON(): Record<string, unknown> }) => row.toJSON());
}

export async function handleExec(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload } = ctx;
  const req = payload as { sql?: string };
  if (!connection) throw new Error('DuckDB not initialized');
  await connection.query(req.sql ?? '');
  return { ok: true };
}

export async function handleShutdown(): Promise<unknown> {
  await connection?.close();
  await db?.terminate();
  connection = null;
  db = null;
  return { ok: true };
}

registerTaskHandler(
  'db.duckdb.init',
  async (ctx) => {
    await initDuckDb(ctx.emitProgress);
    return { ok: true };
  },
  ['db.duckdb'],
);

registerTaskHandler('db.duckdb.query', handleQuery, ['db.duckdb']);
registerTaskHandler('db.duckdb.exec', handleExec, ['db.duckdb']);
registerTaskHandler('db.duckdb.shutdown', handleShutdown, ['db.duckdb']);
