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

async function initDuckDb(): Promise<void> {
  const { AsyncDuckDB, selectBundle, ConsoleLogger } = await getDuckDb();

  const JSDELIVR_BUNDLES = {
    mvp: {
      mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
      mainWorker:
        'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
      mainWorker:
        'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js',
    },
  };

  const bundle = await selectBundle(JSDELIVR_BUNDLES);
  const logger = new ConsoleLogger();
  if (!bundle.mainWorker) throw new Error('DuckDB bundle has no worker URL');
  const worker = new Worker(bundle.mainWorker);
  const newDb = new AsyncDuckDB(logger, worker);
  await newDb.instantiate(bundle.mainModule);

  const useOpfs = await isOPFSSupported();
  if (useOpfs) {
    try {
      const { DuckDBDataProtocol } = await getDuckDb();
      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle('storycraft_analytics.duckdb', {
        create: true,
      });
      await newDb.registerFileHandle(
        'storycraft_analytics.duckdb',
        fileHandle,
        DuckDBDataProtocol.BROWSER_FSACCESS,
        true,
      );
      connection = await newDb.connect();
      await connection.query("ATTACH 'storycraft_analytics.duckdb' AS analytics (TYPE duckdb)");
    } catch {
      connection = await newDb.connect();
    }
  } else {
    connection = await newDb.connect();
  }

  db = newDb;
}

async function handleQuery(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload } = ctx;
  const req = payload as { sql?: string };
  if (!connection) throw new Error('DuckDB not initialized');
  const result = await connection.query(req.sql ?? '');
  return result.toArray().map((row: { toJSON(): Record<string, unknown> }) => row.toJSON());
}

async function handleExec(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload } = ctx;
  const req = payload as { sql?: string };
  if (!connection) throw new Error('DuckDB not initialized');
  await connection.query(req.sql ?? '');
  return { ok: true };
}

async function handleShutdown(): Promise<unknown> {
  await connection?.close();
  await db?.terminate();
  connection = null;
  db = null;
  return { ok: true };
}

registerTaskHandler('db.duckdb.init', async () => {
  await initDuckDb();
  return { ok: true };
}, ['db.duckdb']);

registerTaskHandler('db.duckdb.query', handleQuery, ['db.duckdb']);
registerTaskHandler('db.duckdb.exec', handleExec, ['db.duckdb']);
registerTaskHandler('db.duckdb.shutdown', handleShutdown, ['db.duckdb']);
