/**
 * Local “RAG” index: hashed bag-of-words vectors + storage via StorageBackend.saveRagVectors.
 * QNBS-v3: Offline retrieval without cloud — real embeddings can use the same API later.
 */

import type { StorySection } from '../types';
import { storageService } from './storageService';

export interface LocalRagChunkRecord {
  id: string;
  sectionId: string;
  chunkIndex: number;
  text: string;
  vector: number[];
}

const DIM = 64;

function cosineSimilarity(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
}

/** Deterministischer Pseudo-Embedding-Vektor (L2-normalisiert). */
export function hashEmbedText(text: string, dim = DIM): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().match(/\p{L}+|\d+/gu) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function chunkSection(content: string, maxChars = 1200): string[] {
  const paras = content.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + p).length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.length ? chunks : [''];
}

export async function rebuildLocalRagIndex(
  projectId: string,
  manuscript: StorySection[],
): Promise<number> {
  const records: LocalRagChunkRecord[] = [];
  for (let i = 0; i < manuscript.length; i++) {
    const sec = manuscript[i];
    if (!sec) continue;
    const parts = chunkSection(sec.content ?? '');
    parts.forEach((text, chunkIndex) => {
      if (!text.trim()) return;
      records.push({
        id: `${sec.id}:${chunkIndex}`,
        sectionId: sec.id,
        chunkIndex,
        text,
        vector: hashEmbedText(text),
      });
    });
    // QNBS-v3: UI-Thread entlasten bei langen Romanen — Mikro-Yield alle paar Szenen.
    if (i % 5 === 4) await Promise.resolve();
  }
  await storageService.saveRagVectors(projectId, records);
  return records.length;
}

export async function searchLocalRag(
  projectId: string,
  query: string,
  topK = 5,
): Promise<{ score: number; text: string; sectionId: string }[]> {
  const raw = (await storageService.getRagVectors(projectId)) as LocalRagChunkRecord[];
  const q = hashEmbedText(query);
  return raw
    .filter((r) => Array.isArray(r.vector) && r.vector.length === q.length)
    .map((r) => ({
      score: cosineSimilarity(r.vector, q),
      text: r.text,
      sectionId: r.sectionId,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
