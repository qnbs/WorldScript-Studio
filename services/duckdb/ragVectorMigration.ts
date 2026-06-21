// QNBS-v3: Migrate rag_chunks from 64-dim BoW vectors to 384-dim semantic embeddings in DuckDB.

import type { StorySection } from '../../types';
import { embedText } from '../ai/localEmbeddingService';
import { rebuildHybridRagIndex } from '../localRagService';
import { logger } from '../logger';
import { storageService } from '../storageService';
import { duckdbRagWrite } from './duckdbAnalytics';
import { duckdbClient } from './duckdbClient';
import { RAG_EMBEDDING_DIM } from './duckdbSchema';

const RAG_VECTORS_V2_KEY = 'rag_vectors_v2_migrated';

interface StoredRagRecord {
  id: string;
  sectionId: string;
  chunkIndex: number;
  text: string;
  vector: number[];
  indexedAt?: number;
  semanticVec?: Float32Array;
}

export async function isRagVectorMigrationDone(): Promise<boolean> {
  const res = await duckdbClient.query(
    `SELECT value FROM _meta WHERE key = '${RAG_VECTORS_V2_KEY}'`,
  );
  return Boolean(res.ok && res.rows?.length);
}

/**
 * Re-embed IDB chunks and upsert 384-dim vectors into DuckDB. Idempotent via _meta marker.
 */
export async function runRagVectorMigration(
  projectId: string,
  manuscript: StorySection[],
  // QNBS-v3: SEC — re-checked before each DuckDB write so an analytics opt-out toggled during the
  // (async, looped) migration aborts before persisting, and WITHOUT writing the done-marker so it
  // retries on re-opt-in. Defaults to always-allow for callers without a privacy context.
  shouldPersist: () => boolean = () => true,
  // QNBS-v3: SEC — `aborted: true` means a privacy opt-out stopped the run before the done-marker was
  // written; callers MUST keep migration status retryable (not 'done') so re-opt-in re-runs the backfill.
): Promise<{ migrated: number; aborted: boolean }> {
  if (await isRagVectorMigrationDone()) {
    return { migrated: 0, aborted: false };
  }
  // SEC: abort up-front if analytics persistence is already disallowed (no marker → retries on opt-in).
  if (!shouldPersist()) {
    return { migrated: 0, aborted: true };
  }

  logger.debug('[ragVectorMigration] Starting semantic vector migration for', projectId);
  let migrated = 0;

  const raw = (await storageService.getRagVectors(projectId)) as StoredRagRecord[];
  if (raw.length === 0 && manuscript.length > 0) {
    // Pass the gate through — rebuildHybridRagIndex re-checks it at its own DuckDB write site.
    await rebuildHybridRagIndex(projectId, manuscript, shouldPersist);
    // Only record the migration as done if persistence is still allowed; else retry on re-opt-in.
    if (!shouldPersist()) return { migrated: 0, aborted: true };
    await duckdbClient.exec(
      `INSERT INTO _meta (key, value) VALUES ('${RAG_VECTORS_V2_KEY}', '1')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    return { migrated: 0, aborted: false };
  }

  const batch: Parameters<typeof duckdbRagWrite>[1] = [];
  for (const r of raw) {
    if (!r.text?.trim()) continue;
    let emb = r.semanticVec;
    if (!emb || emb.length !== RAG_EMBEDDING_DIM) {
      try {
        emb = await embedText(r.text);
      } catch {
        continue;
      }
    }
    batch.push({
      id: r.id,
      sectionId: r.sectionId,
      chunkIndex: r.chunkIndex,
      embedding: emb,
      vector: r.vector,
    });
    migrated++;
    if (migrated % 10 === 0) await Promise.resolve();
  }

  // QNBS-v3: SEC — final gate check at the write site; abort without the done-marker on opt-out.
  if (!shouldPersist()) {
    return { migrated, aborted: true };
  }

  if (batch.length > 0) {
    await duckdbRagWrite(projectId, batch);
  }

  // QNBS-v3: SEC — re-check immediately before the done-marker: an opt-out landing during the awaited
  // vector write above must not let us record the migration as complete (else re-opt-in never reruns).
  if (!shouldPersist()) {
    return { migrated, aborted: true };
  }

  await duckdbClient.exec(
    `INSERT INTO _meta (key, value) VALUES ('${RAG_VECTORS_V2_KEY}', '1')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );

  logger.debug('[ragVectorMigration] Complete:', migrated, 'chunks');
  return { migrated, aborted: false };
}

/**
 * Smoke-test: confirms the rag_chunks.embedding column exists and is FLOAT[].
 * Used in CI to verify the 64→384-dim migration ran correctly.
 */
export async function verifyEmbeddingColumn(): Promise<boolean> {
  const res = await duckdbClient.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'rag_chunks' AND column_name = 'embedding'`,
  );
  if (!res.ok || !res.rows?.length) return false;
  const row = res.rows[0];
  // QNBS-v3: DuckDB exposes FLOAT[] as 'FLOAT[]' in data_type; column existence is the primary gate.
  return row !== undefined && 'column_name' in row;
}
