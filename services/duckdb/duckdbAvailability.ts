/**
 * Whether this build runs DuckDB analytics at all.
 *
 * QNBS-v3 (#716): maintainer decision of 2026-11-13 — v1.29.7 allows DuckDB only in a proven-safe memory-only mode,
 * and otherwise disables it in a controlled way. Its boot never became ready in production, while its worker still
 * touched OPFS, so memory-only would switch on code paths that never ran. This build therefore starts no DuckDB
 * worker and touches no OPFS entry; existing OPFS files stay as they are.
 */
export const DUCKDB_ANALYTICS_AVAILABLE = false;

/** Why every DuckDB call is refused in this build. */
export const DUCKDB_UNAVAILABLE_REASON = 'DuckDB analytics are not available in this version.';
