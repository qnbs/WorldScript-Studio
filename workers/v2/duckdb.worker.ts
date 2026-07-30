/// <reference lib="webworker" />
// QNBS-v3: [Sole DuckDB worker generation post-consolidation (docs/adr/0014); formerly wrapped the now-deleted legacy workers/duckdbWorker.ts.]

import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import {
  registerTaskHandler,
  type WorkerHandlerContext,
} from '../../packages/worker-bus/src/workerBootstrap';
import { createLogger } from '../../services/logger';

// QNBS-v3: [services/logger.ts is worker-safe — its window.localStorage/Tauri touches are all
//          guarded (typeof window !== 'undefined' / dynamic import) — so this matches
//          workerBusManager.ts's log.warn/log.error convention instead of raw console.warn.]
const log = createLogger('duckdb.worker');

let duckdbModule: typeof import('@duckdb/duckdb-wasm') | null = null;
let db: AsyncDuckDB | null = null;
let connection: AsyncDuckDBConnection | null = null;

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

// QNBS-v3 (F-09): [Self-hosted, same-origin DuckDB-WASM assets — replaces an unpinned CDN URL that was already CSP-dead (supply-chain trust); see docs/adr/0013-csp-wasm-and-blob-frames.md.]
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
    let opfsConnection: AsyncDuckDBConnection | null = null;
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
        log.warn('Failed to close partial OPFS connection', closeErr);
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

interface DuckDbQueryResult {
  toArray(): Array<{ toJSON(): Record<string, unknown> }>;
}

interface PreparableConnection {
  prepare(sql: string): Promise<{
    query(...params: unknown[]): Promise<DuckDbQueryResult>;
    close(): Promise<void>;
  }>;
}

// QNBS-v3: [tsgo doesn't resolve AsyncDuckDBConnection.prepare() through this package's nested
//          `export *` chain (present and correct in @duckdb/duckdb-wasm's own .d.ts, verified
//          directly) — a narrow structural type sidesteps the gap, the same class of tsgo/external-
//          package resolution issue CLAUDE.md documents for the transformers.js path alias.]
function asPreparable(conn: AsyncDuckDBConnection): PreparableConnection {
  return conn as unknown as PreparableConnection;
}

// QNBS-v3: [Bind via a prepared statement when params are present — a raw connection.query(sql) silently drops them, leaving an unbound query and a SQL-injection surface.]
async function runSql(sql: string, params?: readonly unknown[]): Promise<DuckDbQueryResult> {
  if (!connection) throw new Error('DuckDB not initialized');
  if (params && params.length > 0) {
    const stmt = await asPreparable(connection).prepare(sql);
    try {
      return await stmt.query(...params);
    } finally {
      await stmt.close();
    }
  }
  return connection.query(sql);
}

export async function handleQuery(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload } = ctx;
  const req = payload as { sql?: string; params?: readonly unknown[] };
  const result = await runSql(req.sql ?? '', req.params);
  return result.toArray().map((row: { toJSON(): Record<string, unknown> }) => row.toJSON());
}

export async function handleExec(ctx: WorkerHandlerContext): Promise<unknown> {
  const { payload } = ctx;
  const req = payload as { sql?: string; params?: readonly unknown[] };
  await runSql(req.sql ?? '', req.params);
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
