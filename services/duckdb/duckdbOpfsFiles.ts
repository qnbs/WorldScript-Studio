// QNBS-v3: pure constants, safe to import from both the DuckDB worker and main-thread services (factory reset) — one source of truth for the OPFS entries WorldScript positively owns, so the file the worker creates and the file reset deletes can never drift apart.
export const DUCKDB_OPFS_FILE_NAME = 'worldscript_analytics.duckdb';

// QNBS-v3: only the worldscript_-prefixed database and its write-ahead log — never a generic or vendor-named OPFS entry another same-origin app could also own.
export const DUCKDB_OWNED_OPFS_ENTRIES: readonly string[] = [
  DUCKDB_OPFS_FILE_NAME,
  `${DUCKDB_OPFS_FILE_NAME}.wal`,
];
