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

export interface SceneOverlapWithTitlesRow {
  section_a: string;
  section_b: string;
  title_a: string;
  title_b: string;
}

export interface RagSimilarityRow {
  chunk_id: string;
  section_id: string;
  chunk_index: number;
  score: number;
}

export interface CharacterCoOccurrenceRow {
  character_a: string;
  character_b: string;
  project_id: string;
  shared_sections: number;
}

export interface CrossProjectSearchRow {
  project_id: string;
  title: string;
  logline: string;
  manuscript_word_count: number;
  character_names: string[];
  last_indexed: string;
  score: number;
}

/**
 * Retry wrapper for idempotent DuckDB operations (ON CONFLICT DO UPDATE is safe to replay).
 * Exponential backoff with jitter: 1 s + jitter, 2 s + jitter, then throws.
 */
export async function withDuckDbRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const jitter = Math.floor(Math.random() * 150) + 50;
        await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** (attempt - 1) + jitter));
      }
    }
  }
  throw lastErr;
}

/** Escape single-quotes in a SQL string literal. */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/** Execute SQL or throw — enables withDuckDbRetry to detect partial write failures. */
async function execOrThrow(sql: string): Promise<void> {
  const res = await duckdbClient.exec(sql);
  if (!res.ok) throw new Error(`DuckDB exec failed: ${res.error ?? 'unknown'}`);
}

/** Convert a number/Float32Array vector to a DuckDB FLOAT[] literal. */
function vecToSqlLiteral(vec: Float32Array | number[]): string {
  return `[${Array.from(vec)
    .map((v) => v.toFixed(8))
    .join(',')}]::FLOAT[]`;
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

/** Scene overlaps enriched with section titles via LEFT JOIN — used by evaluateSceneTimelineDuckDb. */
export async function querySceneOverlapsWithTitles(
  projectId: string,
  limit = 32,
  signal?: AbortSignal,
): Promise<SceneOverlapWithTitlesRow[]> {
  const res = await duckdbClient.query(
    `SELECT v.section_a, v.section_b,
            COALESCE(sa.title, v.section_a) AS title_a,
            COALESCE(sb.title, v.section_b) AS title_b
     FROM v_scene_overlap v
     LEFT JOIN sections sa ON sa.section_id = v.section_a
     LEFT JOIN sections sb ON sb.section_id = v.section_b
     WHERE v.project_id = '${esc(projectId)}'
     LIMIT ${limit}`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as SceneOverlapWithTitlesRow[]) : [];
}

/** Vector similarity search over rag_chunks using DuckDB list_dot_product — P2. */
export async function queryRagSimilarity(
  projectId: string,
  queryVector: Float32Array | number[],
  topK = 5,
  signal?: AbortSignal,
): Promise<RagSimilarityRow[]> {
  const vecLiteral = vecToSqlLiteral(queryVector);
  const res = await duckdbClient.query(
    `SELECT chunk_id, section_id, chunk_index,
            list_dot_product(vector, ${vecLiteral}) AS score
     FROM rag_chunks
     WHERE project_id = '${esc(projectId)}'
       AND vector IS NOT NULL
     ORDER BY score DESC
     LIMIT ${topK}`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as RagSimilarityRow[]) : [];
}

/** Character co-occurrence via v_character_cooccurrence — P3. */
export async function queryCharacterCoOccurrence(
  projectId: string,
  signal?: AbortSignal,
): Promise<CharacterCoOccurrenceRow[]> {
  const res = await duckdbClient.query(
    `SELECT character_a, character_b, project_id, shared_sections
     FROM v_character_cooccurrence
     WHERE project_id = '${esc(projectId)}'
     ORDER BY shared_sections DESC`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as CharacterCoOccurrenceRow[]) : [];
}

/** Semantic cross-project search via list_dot_product on cross_project_index — P3. */
export async function queryCrossProjectSearch(
  queryVector: Float32Array | number[],
  topK = 5,
  signal?: AbortSignal,
): Promise<CrossProjectSearchRow[]> {
  const vecLiteral = vecToSqlLiteral(queryVector);
  const res = await duckdbClient.query(
    `SELECT project_id, title, logline, manuscript_word_count, character_names,
            last_indexed::TEXT AS last_indexed,
            list_dot_product(embedding_vector, ${vecLiteral}) AS score
     FROM cross_project_index
     WHERE embedding_vector IS NOT NULL
     ORDER BY score DESC
     LIMIT ${topK}`,
    undefined,
    signal,
  );
  return res.ok ? (res.rows as unknown as CrossProjectSearchRow[]) : [];
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
    // QNBS-v3: scene_start populated for v_scene_overlap; absent for pre-P3 callers.
    scene_start?: string | undefined;
  }[],
): Promise<void> {
  const now = new Date().toISOString();

  // Upsert project row
  await execOrThrow(
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
    await execOrThrow(
      `INSERT INTO writing_history (project_id, date, words) VALUES ${vals}
       ON CONFLICT (project_id, date) DO UPDATE SET words = EXCLUDED.words`,
    );
  }

  // Upsert section word counts + scene_start for timeline overlap view
  if (sections.length > 0) {
    for (const s of sections) {
      await execOrThrow(
        `INSERT INTO sections (section_id, project_id, title, word_count, status, position, scene_start, indexed_at)
         VALUES ('${esc(s.id)}', '${esc(projectId)}', '${esc(s.title)}',
           ${s.wordCount}, '${esc(s.status ?? 'draft')}', ${s.position},
           ${s.scene_start ? `'${esc(s.scene_start)}'` : 'NULL'}, '${now}')
         ON CONFLICT (section_id) DO UPDATE SET
           word_count = EXCLUDED.word_count, status = EXCLUDED.status,
           position = EXCLUDED.position, scene_start = EXCLUDED.scene_start,
           indexed_at = EXCLUDED.indexed_at`,
      );
    }
  }
}

/** Upsert RAG chunk vectors (text stays in IDB; only vectors written to DuckDB) — P2. */
export async function duckdbRagWrite(
  projectId: string,
  chunks: { id: string; sectionId: string; chunkIndex: number; vector: number[] }[],
): Promise<void> {
  if (chunks.length === 0) return;
  const now = new Date().toISOString();
  for (const c of chunks) {
    const vecLiteral = vecToSqlLiteral(c.vector);
    await execOrThrow(
      `INSERT INTO rag_chunks (chunk_id, project_id, section_id, chunk_index, vector, indexed_at)
       VALUES ('${esc(c.id)}', '${esc(projectId)}', '${esc(c.sectionId)}', ${c.chunkIndex},
         ${vecLiteral}, '${now}')
       ON CONFLICT (chunk_id) DO UPDATE SET
         vector = EXCLUDED.vector, indexed_at = EXCLUDED.indexed_at`,
    );
  }
}

/** Upsert cross-project index entry (metadata + optional embedding) — P3. */
export async function duckdbCrossProjectWrite(entry: {
  projectId: string;
  title: string;
  logline: string;
  manuscriptWordCount: number;
  characterNames: string[];
  embeddingVector?: Float32Array | number[] | undefined;
}): Promise<void> {
  const now = new Date().toISOString();
  const vecLiteral = entry.embeddingVector ? vecToSqlLiteral(entry.embeddingVector) : 'NULL';
  const charNamesLiteral =
    entry.characterNames.length > 0
      ? `['${entry.characterNames.map((n) => esc(n)).join("','")}']`
      : '[]::VARCHAR[]';
  await execOrThrow(
    `INSERT INTO cross_project_index
       (project_id, title, logline, manuscript_word_count, character_names, embedding_vector, last_indexed)
     VALUES ('${esc(entry.projectId)}', '${esc(entry.title)}', '${esc(entry.logline)}',
       ${entry.manuscriptWordCount}, ${charNamesLiteral}, ${vecLiteral}, '${now}')
     ON CONFLICT (project_id) DO UPDATE SET
       title = EXCLUDED.title, logline = EXCLUDED.logline,
       manuscript_word_count = EXCLUDED.manuscript_word_count,
       character_names = EXCLUDED.character_names,
       embedding_vector = COALESCE(EXCLUDED.embedding_vector, cross_project_index.embedding_vector),
       last_indexed = EXCLUDED.last_indexed`,
  );
}

/** Upsert codex entities and their section mentions (names/types only — no content) — P3. */
export async function duckdbCodexWrite(
  projectId: string,
  entities: {
    id: string;
    name: string;
    type: string;
    mentionCount: number;
    mentions: { sectionId: string; excerpt: string }[];
  }[],
): Promise<void> {
  if (entities.length === 0) return;
  for (const e of entities) {
    await execOrThrow(
      `INSERT INTO codex_entities (entity_id, project_id, name, entity_type, mention_count)
       VALUES ('${esc(e.id)}', '${esc(projectId)}', '${esc(e.name)}', '${esc(e.type)}', ${e.mentionCount})
       ON CONFLICT (entity_id, project_id) DO UPDATE SET
         name = EXCLUDED.name, entity_type = EXCLUDED.entity_type,
         mention_count = EXCLUDED.mention_count`,
    );
    for (const m of e.mentions) {
      await execOrThrow(
        `INSERT INTO codex_mentions (entity_id, project_id, section_id, excerpt)
         VALUES ('${esc(e.id)}', '${esc(projectId)}', '${esc(m.sectionId)}', '${esc(m.excerpt)}')
         ON CONFLICT (entity_id, project_id, section_id) DO UPDATE SET excerpt = EXCLUDED.excerpt`,
      );
    }
  }
}
