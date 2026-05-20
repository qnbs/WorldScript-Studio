// QNBS-v3: Typed query helpers for the DuckDB-WASM analytics layer.
//          All queries operate on plaintext columns only — no encrypted BLOBs.

import { computeStreak } from '../../features/progressTracker/progressTrackerSlice';
import { duckdbClient } from './duckdbClient';

export interface DailyProgressRow {
  project_id: string;
  date: string;
  words: number;
  rolling_7day_avg: number;
}

export interface WeeklyProgressRow {
  project_id: string;
  week_start: string;
  weekly_words: number;
}

export interface SceneOverlapRow {
  section_a: string;
  section_b: string;
  project_id: string;
  scene_start_a: string;
  scene_start_b: string;
}

/** Escape single-quotes in a SQL string literal. */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

export async function queryDailyProgress(
  projectId: string,
  days = 30,
  signal?: AbortSignal,
): Promise<DailyProgressRow[]> {
  const res = await duckdbClient.query(
    `SELECT project_id, date::TEXT AS date, words, COALESCE(rolling_7day_avg, 0) AS rolling_7day_avg
     FROM v_daily_progress
     WHERE project_id = '${esc(projectId)}'
       AND date >= (CURRENT_DATE - INTERVAL '${days} days')
     ORDER BY date ASC`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as DailyProgressRow[]) : [];
}

export async function queryWeeklyProgress(
  projectId: string,
  weeks = 12,
  signal?: AbortSignal,
): Promise<WeeklyProgressRow[]> {
  const res = await duckdbClient.query(
    `SELECT project_id, week_start::TEXT AS week_start, weekly_words
     FROM v_weekly_progress
     WHERE project_id = '${esc(projectId)}'
       AND week_start >= (CURRENT_DATE - INTERVAL '${weeks} weeks')
     ORDER BY week_start ASC`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as WeeklyProgressRow[]) : [];
}

export async function queryStreak(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ current: number; longest: number }> {
  const res = await duckdbClient.query(
    `SELECT date::TEXT AS date, words
     FROM writing_history
     WHERE project_id = '${esc(projectId)}'
     ORDER BY date ASC`,
    undefined,
    signal,
  );
  if (!res.ok || !res.rows?.length) return { current: 0, longest: 0 };
  // QNBS-v3: Reuse the authoritative computeStreak logic instead of reimplementing.
  return computeStreak(res.rows as { date: string; words: number }[]);
}

export async function querySceneOverlaps(
  projectId: string,
  signal?: AbortSignal,
): Promise<SceneOverlapRow[]> {
  const res = await duckdbClient.query(
    `SELECT section_a, section_b, project_id, scene_start_a, scene_start_b
     FROM v_scene_overlap
     WHERE project_id = '${esc(projectId)}'`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as SceneOverlapRow[]) : [];
}

/** Upsert project metadata and writing history rows (non-sensitive plaintext only). */
export async function duckdbDualWrite(
  projectId: string,
  title: string,
  logline: string,
  totalWordCount: number,
  targetWordCount: number | undefined,
  targetDate: string | null | undefined,
  writingHistory: { date: string; words: number }[],
  sections: {
    id: string;
    title: string;
    wordCount: number;
    status?: string | undefined;
    position: number;
  }[],
): Promise<void> {
  const now = new Date().toISOString();

  // Upsert project row
  await duckdbClient.exec(
    `INSERT INTO projects (project_id, title, logline, total_word_count, target_word_count, target_date, updated_at)
     VALUES ('${esc(projectId)}', '${esc(title)}', '${esc(logline)}', ${totalWordCount},
       ${targetWordCount ?? 'NULL'}, ${targetDate ? `'${esc(targetDate)}'` : 'NULL'}, '${now}')
     ON CONFLICT (project_id) DO UPDATE SET
       title = EXCLUDED.title, logline = EXCLUDED.logline,
       total_word_count = EXCLUDED.total_word_count,
       target_word_count = EXCLUDED.target_word_count,
       target_date = EXCLUDED.target_date,
       updated_at = EXCLUDED.updated_at`,
  );

  // Upsert writing_history rows
  if (writingHistory.length > 0) {
    const vals = writingHistory
      .map((h) => `('${esc(projectId)}', '${esc(h.date)}', ${h.words})`)
      .join(',');
    await duckdbClient.exec(
      `INSERT INTO writing_history (project_id, date, words) VALUES ${vals}
       ON CONFLICT (project_id, date) DO UPDATE SET words = EXCLUDED.words`,
    );
  }

  // Upsert section word counts (plaintext analytics columns only)
  if (sections.length > 0) {
    for (const s of sections) {
      await duckdbClient.exec(
        `INSERT INTO sections (section_id, project_id, title, word_count, status, position, indexed_at)
         VALUES ('${esc(s.id)}', '${esc(projectId)}', '${esc(s.title)}',
           ${s.wordCount}, '${esc(s.status ?? 'draft')}', ${s.position}, '${now}')
         ON CONFLICT (section_id) DO UPDATE SET
           word_count = EXCLUDED.word_count, status = EXCLUDED.status,
           position = EXCLUDED.position, indexed_at = EXCLUDED.indexed_at`,
      );
    }
  }
}
