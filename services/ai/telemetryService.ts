/**
 * telemetryService.ts — Local AI inference telemetry sink.
 * QNBS-v3: C2 — Records inference metrics to DuckDB (ai_telemetry table) or localStorage fallback.
 *          Strictly local — NO data leaves the device. Gated by enableDuckDbAnalytics flag.
 */

import { duckdbClient } from '../duckdb/duckdbClient';
import { logger as log } from '../logger';

// QNBS-v3: Module-level gate — caller (App.tsx / listenerMiddleware) syncs this with the
//          enableDuckDbAnalytics feature flag. Both DuckDB and localStorage writes are skipped
//          when disabled, preventing data collection the user hasn't opted into.
let _telemetryEnabled = false;

/** Called by App.tsx and the featureFlags listener to keep telemetry in sync with the flag. */
export function setTelemetryEnabled(enabled: boolean): void {
  _telemetryEnabled = enabled;
}

const TELEMETRY_STORAGE_KEY = 'worldscript-ai-telemetry';
const MAX_LOCAL_ENTRIES = 200;

// DuckDB table DDL — created on first write
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ai_telemetry (
    task_type VARCHAR NOT NULL,
    backend   VARCHAR NOT NULL,
    model_id  VARCHAR NOT NULL,
    latency_ms INTEGER NOT NULL,
    success   BOOLEAN NOT NULL DEFAULT TRUE,
    ts        TIMESTAMP DEFAULT NOW()
  )
`;

export interface InferenceTelemetryEntry {
  taskType: string;
  backend: string;
  modelId: string;
  latencyMs: number;
  success: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// DuckDB path
// ---------------------------------------------------------------------------

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await duckdbClient.exec(CREATE_TABLE_SQL);
  tableEnsured = true;
}

async function writeToDuckDb(entry: InferenceTelemetryEntry): Promise<void> {
  await ensureTable();
  await duckdbClient.exec(
    `INSERT INTO ai_telemetry (task_type, backend, model_id, latency_ms, success)
     VALUES (?, ?, ?, ?, ?)`,
    [entry.taskType, entry.backend, entry.modelId, entry.latencyMs, entry.success],
  );
}

// ---------------------------------------------------------------------------
// localStorage fallback
// ---------------------------------------------------------------------------

function readLocalEntries(): InferenceTelemetryEntry[] {
  try {
    const raw = localStorage.getItem(TELEMETRY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as InferenceTelemetryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLocalEntry(entry: InferenceTelemetryEntry): void {
  try {
    const entries = readLocalEntries();
    entries.push(entry);
    // LRU: keep newest MAX_LOCAL_ENTRIES
    const trimmed = entries.slice(-MAX_LOCAL_ENTRIES);
    localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    log.warn('Telemetry localStorage write failed', err as Error);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a single inference telemetry entry.
 * QNBS-v3: No-op when enableDuckDbAnalytics is off — prevents collecting data the user
 *          hasn't opted into. setTelemetryEnabled() must be called from App.tsx on init.
 * Prefers DuckDB when available; falls back to localStorage.
 */
export async function recordInferenceTelemetry(entry: InferenceTelemetryEntry): Promise<void> {
  if (!_telemetryEnabled) return;
  try {
    await writeToDuckDb(entry);
  } catch {
    // DuckDB unavailable (worker not ready, etc.) — use local fallback
    writeLocalEntry(entry);
  }
}

/**
 * Retrieve recent telemetry entries (most recent first).
 * Reads from DuckDB if available, otherwise from localStorage.
 */
export async function getRecentTelemetry(limit = 50): Promise<InferenceTelemetryEntry[]> {
  try {
    const resp = await duckdbClient.query(
      `SELECT task_type, backend, model_id, latency_ms, success,
              epoch_ms(ts) AS timestamp
       FROM ai_telemetry
       ORDER BY ts DESC
       LIMIT ?`,
      [limit],
    );
    if (resp.rows) {
      return (resp.rows as Array<Record<string, unknown>>).map((r) => ({
        taskType: String(r['task_type'] ?? ''),
        backend: String(r['backend'] ?? ''),
        modelId: String(r['model_id'] ?? ''),
        latencyMs: Number(r['latency_ms'] ?? 0),
        success: Boolean(r['success'] ?? true),
        timestamp: Number(r['timestamp'] ?? 0),
      }));
    }
  } catch {
    // DuckDB unavailable — return local fallback
  }
  return readLocalEntries().reverse().slice(0, limit);
}

/**
 * Clear all telemetry records from DuckDB and localStorage.
 */
export async function clearTelemetry(): Promise<void> {
  try {
    await duckdbClient.exec('DELETE FROM ai_telemetry');
    tableEnsured = false;
  } catch {
    // DuckDB unavailable
  }
  try {
    localStorage.removeItem(TELEMETRY_STORAGE_KEY);
  } catch {
    // Storage unavailable (SSR / test env)
  }
}
