// QNBS-v3: One-time IDB→DuckDB seed job. Reads project state, inserts plaintext analytics rows.
//          Sensitive columns (content, backstory, etc.) are NOT migrated in P1 — deferred to P2.
//          Idempotent: writes _meta marker on success; re-runs if marker absent.

import { logger } from '../logger';
import { duckdbDualWrite } from './duckdbAnalytics';
import { duckdbClient } from './duckdbClient';
import { DUCK_DB_SCHEMA_VERSION } from './duckdbSchema';

const MIGRATION_MARKER_KEY = `schema_v${DUCK_DB_SCHEMA_VERSION}_migrated`;

export interface MigratableProjectData {
  id?: string | undefined;
  title: string;
  logline: string;
  projectGoals?: { totalWordCount: number; targetDate: string | null } | undefined;
  writingHistory?: { date: string; words: number }[] | undefined;
  manuscript: {
    id: string;
    title: string;
    content?: string | undefined;
    status?: string | undefined;
  }[];
}

function countWords(text: string | undefined): number {
  if (!text) return 0;
  return (text.match(/\S+/g) ?? []).length;
}

/** Check whether the migration has already run for this schema version. */
export async function isMigrated(): Promise<boolean> {
  const res = await duckdbClient.query(
    `SELECT value FROM _meta WHERE key = '${MIGRATION_MARKER_KEY}'`,
  );
  return Boolean(res.ok && res.rows?.length);
}

/**
 * Run the one-time seed migration if the marker is absent.
 * Safe to call multiple times — no-ops if already done.
 */
export async function runIfNeeded(project: MigratableProjectData): Promise<void> {
  if (await isMigrated()) return;

  const projectId = project.id ?? 'default';
  logger.debug('[duckdbMigration] Starting P1 seed migration for project', projectId);

  try {
    const sections = project.manuscript.map((s, idx) => ({
      id: s.id,
      title: s.title,
      wordCount: countWords(s.content),
      status: s.status,
      position: idx,
    }));

    const totalWordCount = sections.reduce((acc, s) => acc + s.wordCount, 0);

    await duckdbDualWrite(
      projectId,
      project.title,
      project.logline,
      totalWordCount,
      project.projectGoals?.totalWordCount,
      project.projectGoals?.targetDate,
      project.writingHistory ?? [],
      sections,
    );

    // Write migration marker — only after all inserts succeed
    await duckdbClient.exec(
      `INSERT INTO _meta (key, value) VALUES ('${MIGRATION_MARKER_KEY}', '${DUCK_DB_SCHEMA_VERSION}')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    logger.debug('[duckdbMigration] Seed migration complete');
  } catch (err) {
    logger.warn('[duckdbMigration] Seed migration failed (non-fatal):', err);
    // Marker NOT written → will retry on next app load
    throw err;
  }
}
