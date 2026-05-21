// QNBS-v3: Minimal typings for @duckdb/duckdb-wasm in the DuckDB web worker.
// Full package types resolve after `pnpm install`; this keeps `tsc` green in CI without bundling WASM into main.

declare module '@duckdb/duckdb-wasm' {
  export class ConsoleLogger {
    constructor();
  }

  export enum DuckDBDataProtocol {
    BROWSER_FSACCESS = 'BROWSER_FSACCESS',
  }

  export interface DuckDBBundles {
    mvp: { mainModule: string; mainWorker: string };
    eh: { mainModule: string; mainWorker: string };
  }

  export interface DuckDBBundle {
    mainModule: string;
    mainWorker: string | null;
  }

  export function selectBundle(bundles: DuckDBBundles): Promise<DuckDBBundle>;

  export interface DuckDBRow {
    toJSON(): Record<string, unknown>;
  }

  export interface DuckDBQueryResult {
    toArray(): DuckDBRow[];
  }

  export class AsyncDuckDBConnection {
    query(sql: string): Promise<DuckDBQueryResult>;
    close(): Promise<void>;
  }

  export class AsyncDuckDB {
    constructor(logger: ConsoleLogger, worker: Worker);
    instantiate(mainModule: string): Promise<void>;
    registerFileHandle(
      name: string,
      handle: FileSystemFileHandle,
      protocol: DuckDBDataProtocol,
      directIO: boolean,
    ): Promise<void>;
    connect(): Promise<AsyncDuckDBConnection>;
    terminate(): Promise<void>;
  }
}
