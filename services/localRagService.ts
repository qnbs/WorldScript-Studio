/**
 * Hybrid RAG service — wraps the BoW lexical index with optional semantic scoring.
 * QNBS-v3: Unified entry point so callers never need to know which branch is active.
 */

import type { StorySection } from '../types';
import {
  createSimilarityBuffers,
  createSimilarityPipeline,
  encodeSimilarityUniforms,
  getComputeDevice,
} from './ai/computeShaderFactory';
import { embedText } from './ai/localEmbeddingService';
import { duckdbRagWrite, queryRagSimilarity } from './duckdb/duckdbAnalytics';
import {
  hashEmbedText,
  type LocalRagChunkRecord,
  rebuildLocalRagIndex,
  searchLocalRag,
} from './localRagIndex';
import { logger } from './logger';
import { storageService } from './storageService';

export type { LocalRagChunkRecord };
// Re-export for callers that import from this module
export { hashEmbedText, rebuildLocalRagIndex, searchLocalRag };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RagMode = 'lexical' | 'semantic' | 'hybrid';

export interface RagChunk {
  score: number;
  text: string;
  sectionId: string;
  chunkIndex: number;
  indexedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNKS = 500;
// QNBS-v3: Token-based chunking is more stable than paragraph-based for long chapters.
const TOKENS_PER_CHUNK = 300;
const TOKEN_OVERLAP = 50;
const SLIDING_WINDOW_RECENCY = 3;

// Hybrid weight distribution per plan spec (60/30/10)
const W_SEMANTIC = 0.6;
const W_LEXICAL = 0.3;
const W_RECENCY = 0.1;

// ---------------------------------------------------------------------------
// Token-based chunking (replaces paragraph-based for hybrid mode)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+|\d+/gu) ?? [];
}

function buildTokenChunks(content: string): string[] {
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + TOKENS_PER_CHUNK, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = end - TOKEN_OVERLAP;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Extended index record (includes indexedAt for recency scoring)
// ---------------------------------------------------------------------------

interface HybridRagRecord extends LocalRagChunkRecord {
  indexedAt: number;
  // QNBS-v3: populated by embedText() during index build; undefined when embedding unavailable.
  semanticVec?: Float32Array | undefined;
}

/**
 * Rebuild the local RAG index using token-based chunking.
 * Records carry an `indexedAt` timestamp so recency scoring works correctly.
 * Falls back to the BoW rebuilder signature for backward compat.
 */
export async function rebuildHybridRagIndex(
  projectId: string,
  manuscript: StorySection[],
  // QNBS-v3: P2 dual-write — vectors (not text) mirrored to DuckDB when analytics persistence is
  // allowed. SEC: accepts a callback so the caller can re-evaluate the privacy gate at write time
  // (the embedding loop is async — a boolean captured up-front would let an opt-out toggled mid-rebuild
  // leak one stale mirror write). A plain boolean is still accepted for simple/synchronous callers.
  duckDbEnabled: boolean | (() => boolean) = false,
): Promise<number> {
  const records: HybridRagRecord[] = [];

  for (let i = 0; i < manuscript.length; i++) {
    const sec = manuscript[i];
    if (!sec) continue;
    const chunks = buildTokenChunks(sec.content ?? '');
    for (let ci = 0; ci < chunks.length; ci++) {
      const text = chunks[ci] ?? '';
      if (!text.trim()) continue;
      if (records.length >= MAX_CHUNKS) break;
      // QNBS-v3: attempt semantic embedding; graceful degradation to BoW when model not loaded.
      let semanticVec: Float32Array | undefined;
      try {
        semanticVec = await embedText(text);
      } catch {
        // embedding model not ready — hybrid scoring will fall back to BoW proxy
      }
      records.push({
        id: `${sec.id}:${ci}`,
        sectionId: sec.id,
        chunkIndex: ci,
        text,
        vector: hashEmbedText(text),
        // QNBS-v3: StorySection has no real updatedAt; use 1-based position monotonic pseudo-timestamp
        //          so later sections always rank higher in recency scoring, and the value is always > 0.
        //          Stable across re-indexing runs (unlike the previous now-relative approach).
        indexedAt: (i + 1) * 1_000,
        semanticVec,
      });
    }
    if (records.length >= MAX_CHUNKS) break;
    if (i % 5 === 4) await Promise.resolve();
  }

  await storageService.saveRagVectors(projectId, records);

  // QNBS-v3: Mirror vector-only data to DuckDB; text stays in IDB to avoid BLOB encryption.
  // SEC: normalize the gate to a function and re-evaluate it at the LAST synchronous moment before the
  // mirror write (after the async embedding loop AND after building duckChunks), so a mid-rebuild
  // opt-out is honored. The only irreducible window is an opt-out landing during the in-flight DB
  // insert itself, which cannot be interrupted without transactional rollback.
  const gateAllows: () => boolean =
    typeof duckDbEnabled === 'function' ? duckDbEnabled : () => duckDbEnabled;
  if (gateAllows() && records.length > 0) {
    const duckChunks = records
      .filter((r) => r.semanticVec && r.semanticVec.length > 0)
      .map((r) => ({
        id: r.id,
        sectionId: r.sectionId,
        chunkIndex: r.chunkIndex,
        embedding: r.semanticVec as Float32Array,
        vector: r.vector,
      }));
    if (duckChunks.length > 0 && gateAllows()) {
      void duckdbRagWrite(projectId, duckChunks).catch((err: unknown) =>
        logger.warn('DuckDB RAG vector write failed (non-critical):', err),
      );
    }
  }

  return records.length;
}

// ---------------------------------------------------------------------------
// Lexical token overlap score (for hybrid branch)
// ---------------------------------------------------------------------------

function tokenOverlapScore(queryTokens: string[], chunkText: string): number {
  if (queryTokens.length === 0) return 0;
  const chunkTokens = new Set(tokenize(chunkText));
  const matches = queryTokens.filter((t) => chunkTokens.has(t)).length;
  return matches / queryTokens.length;
}

// ---------------------------------------------------------------------------
// GPU batch cosine similarity (B1 — WebGPU acceleration)
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarities for all document vectors against a query embedding on the GPU.
 * Returns null if WebGPU is unavailable or the pipeline dispatch fails.
 * QNBS-v3: Uses batchCosineSimilarity WGSL kernel — 64 threads/workgroup, one thread per doc.
 */
async function batchCosineGpu(
  queryEmbedding: Float32Array,
  docVecs: Float32Array[],
): Promise<number[] | null> {
  if (docVecs.length === 0) return null;
  const device = await getComputeDevice();
  if (!device) return null;

  try {
    const dim = queryEmbedding.length;
    const numDocs = docVecs.length;

    // Flatten all doc vectors into a contiguous Float32Array
    const flatDocs = new Float32Array(numDocs * dim);
    for (let i = 0; i < numDocs; i++) {
      const v = docVecs[i];
      if (v) flatDocs.set(v.length >= dim ? v.subarray(0, dim) : v, i * dim);
    }

    const pipeline = await createSimilarityPipeline(device);
    const buffers = createSimilarityBuffers(device, numDocs, dim);

    device.queue.writeBuffer(buffers.queryBuffer, 0, queryEmbedding);
    device.queue.writeBuffer(buffers.docBuffer, 0, flatDocs);
    encodeSimilarityUniforms(device, buffers.uniformBuffer, numDocs, dim);

    const bindGroup = device.createBindGroup({
      layout: pipeline.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.queryBuffer } },
        { binding: 1, resource: { buffer: buffers.docBuffer } },
        { binding: 2, resource: { buffer: buffers.outBuffer } },
        { binding: 3, resource: { buffer: buffers.uniformBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(numDocs / 64));
    pass.end();
    device.queue.submit([encoder.finish()]);

    // Readback via staging buffer
    const readBuffer = device.createBuffer({
      size: numDocs * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(buffers.outBuffer, 0, readBuffer, 0, numDocs * 4);
    device.queue.submit([copyEncoder.finish()]);

    // 1 = GPUMapMode.READ (avoids global reference for SSR/test compat)
    await readBuffer.mapAsync(1);
    const scores = Array.from(new Float32Array(readBuffer.getMappedRange()));
    readBuffer.unmap();

    // Cleanup GPU resources
    buffers.queryBuffer.destroy();
    buffers.docBuffer.destroy();
    buffers.outBuffer.destroy();
    buffers.uniformBuffer.destroy();
    readBuffer.destroy();

    return scores;
  } catch (err) {
    logger.warn('batchCosineGpu failed, falling back to CPU', { error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// retrieveContext — unified entry point
// ---------------------------------------------------------------------------

/**
 * Retrieve the most relevant context chunks for `query` from `projectId`.
 *
 * Modes:
 *   - 'lexical'  — BoW cosine similarity only (original behaviour)
 *   - 'semantic' — Requires a Float32Array embedding for the query
 *   - 'hybrid'   — 60% semantic + 30% lexical token overlap + 10% recency
 *
 * When `mode` is 'semantic' or 'hybrid' and no `queryEmbedding` is provided,
 * the function falls back to 'lexical' transparently.
 * Set `useGpuSimilarity=true` (with `enableComputeShaders` flag) to batch-rank via WebGPU.
 */
export async function retrieveContext(
  projectId: string,
  query: string,
  topK = 5,
  mode: RagMode = 'lexical',
  queryEmbedding?: Float32Array,
  // QNBS-v3: P2 — when true and queryEmbedding is provided, delegates ranking to DuckDB.
  useDuckDb = false,
  // QNBS-v3: B1 — when true and WebGPU available, uses GPU batch cosine similarity.
  useGpuSimilarity = false,
): Promise<RagChunk[]> {
  // DuckDB path: vector similarity via list_dot_product; text fetched from IDB after ranking.
  if (useDuckDb && queryEmbedding) {
    return retrieveContextViaDuckDb(projectId, topK, queryEmbedding);
  }

  const raw = (await storageService.getRagVectors(projectId)) as HybridRagRecord[];
  if (!raw.length) return [];

  // QNBS-v3: Fall back to lexical when no embedding supplied (model not loaded).
  const activeMode =
    (mode === 'semantic' || mode === 'hybrid') && !queryEmbedding ? 'lexical' : mode;

  const queryBow = hashEmbedText(query);
  const queryTokens = tokenize(query);

  const now = Date.now();
  // Oldest timestamp we'll use for normalising recency (or 1h ago floor)
  const timestamps = raw.map((r) => r.indexedAt ?? now).filter(Boolean);
  const minTs = Math.min(...timestamps, now - 3_600_000);
  const tsRange = now - minTs || 1;

  // QNBS-v3: B1 — GPU batch cosine pre-computation. When useGpuSimilarity=true and
  // WebGPU is available, scores all semantic embeddings in one dispatch instead of per-doc CPU loops.
  let gpuScoresByIndex: Map<number, number> | null = null;
  if (
    useGpuSimilarity &&
    queryEmbedding &&
    (activeMode === 'semantic' || activeMode === 'hybrid')
  ) {
    const semVecsWithIndex: Array<[number, Float32Array]> = raw
      .map((r, i): [number, Float32Array | undefined] => [i, r.semanticVec])
      .filter((pair): pair is [number, Float32Array] => pair[1] !== undefined);

    if (semVecsWithIndex.length > 0) {
      const gpuScores = await batchCosineGpu(
        queryEmbedding,
        semVecsWithIndex.map(([, v]) => v),
      );
      if (gpuScores) {
        gpuScoresByIndex = new Map(semVecsWithIndex.map(([idx], i) => [idx, gpuScores[i] ?? 0]));
      }
    }
  }

  const scored = raw.map((r, rawIdx): RagChunk & { _raw: number } => {
    let score = 0;

    if (activeMode === 'lexical') {
      // Pure BoW cosine on number[] vectors
      const bowVec =
        Array.isArray(r.vector) && r.vector.length === queryBow.length ? r.vector : null;
      score = bowVec ? bowCosineSim(bowVec, queryBow) : 0;
    } else if (activeMode === 'semantic' && queryEmbedding) {
      // GPU-batched score when available; otherwise CPU cosine
      score =
        gpuScoresByIndex?.get(rawIdx) ??
        (r.semanticVec ? cosineSim(r.semanticVec, queryEmbedding) : 0);
    } else if (activeMode === 'hybrid' && queryEmbedding) {
      const semScore =
        gpuScoresByIndex?.get(rawIdx) ??
        (r.semanticVec ? cosineSim(r.semanticVec, queryEmbedding) : 0);
      const lexScore = tokenOverlapScore(queryTokens, r.text);
      const recencyScore = ((r.indexedAt ?? minTs) - minTs) / tsRange;
      score = W_SEMANTIC * semScore + W_LEXICAL * lexScore + W_RECENCY * recencyScore;
    }

    return {
      score,
      text: r.text,
      sectionId: r.sectionId,
      chunkIndex: r.chunkIndex,
      indexedAt: r.indexedAt ?? now,
      _raw: r.indexedAt ?? now,
    };
  });

  // Always include the SLIDING_WINDOW_RECENCY most-recent chunks
  const sortedByRecency = [...scored].sort((a, b) => b._raw - a._raw);
  const slidingWindow = sortedByRecency.slice(0, SLIDING_WINDOW_RECENCY);
  const slidingIds = new Set(slidingWindow.map((c) => `${c.sectionId}:${c.chunkIndex}`));

  const ranked = scored
    .filter((c) => !slidingIds.has(`${c.sectionId}:${c.chunkIndex}`))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, topK - slidingWindow.length));

  const merged = [...slidingWindow, ...ranked].sort((a, b) => b.score - a.score).slice(0, topK);

  return merged.map(({ _raw: _r, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// DuckDB retrieval path (P2)
// ---------------------------------------------------------------------------

// QNBS-v3: Ranking from DuckDB list_dot_product; text resolved from IDB map to avoid BLOB decryption.
async function retrieveContextViaDuckDb(
  projectId: string,
  topK: number,
  queryEmbedding: Float32Array,
): Promise<RagChunk[]> {
  const duckRows = await queryRagSimilarity(projectId, queryEmbedding, topK);
  if (duckRows.length === 0) return [];

  const raw = (await storageService.getRagVectors(projectId)) as HybridRagRecord[];
  const rawById = new Map(raw.map((r) => [r.id, r]));
  const now = Date.now();

  return duckRows
    .map((row) => {
      const rec = rawById.get(row.chunk_id);
      if (!rec) return null;
      return {
        score: row.score,
        text: rec.text,
        sectionId: row.section_id,
        chunkIndex: row.chunk_index,
        indexedAt: rec.indexedAt ?? now,
      };
    })
    .filter((r): r is RagChunk => r !== null);
}

// ---------------------------------------------------------------------------
// Helpers: cosine similarity
// ---------------------------------------------------------------------------

// QNBS-v3: localRagIndex.cosineSimilarity is not exported — reimplemented here for number[].
function bowCosineSim(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot; // vectors from hashEmbedText are already L2-normalised
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
