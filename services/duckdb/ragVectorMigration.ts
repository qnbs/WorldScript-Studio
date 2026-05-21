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
): Promise<{ migrated: number }> {
  if (await isRagVectorMigrationDone()) {
    return { migrated: 0 };
  }

  logger.debug('[ragVectorMigration] Starting semantic vector migration for', projectId);
  let migrated = 0;

  const raw = (await storageService.getRagVectors(projectId)) as StoredRagRecord[];
  if (raw.length === 0 && manuscript.length > 0) {
    await rebuildHybridRagIndex(projectId, manuscript, true);
    await duckdbClient.exec(
      `INSERT INTO _meta (key, value) VALUES ('${RAG_VECTORS_V2_KEY}', '1')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    return { migrated: 0 };
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

  if (batch.length > 0) {
    await duckdbRagWrite(projectId, batch);
  }

  await duckdbClient.exec(
    `INSERT INTO _meta (key, value) VALUES ('${RAG_VECTORS_V2_KEY}', '1')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );

  logger.debug('[ragVectorMigration] Complete:', migrated, 'chunks');
  return { migrated };
}
