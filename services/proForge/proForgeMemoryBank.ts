/**
 * ProForge Memory Bank — Persistent project-specific memory for agentic context.
 * QNBS-v3: IndexedDB-backed storage. Retrieval honours the run's ragMode — keyword by default,
 * or semantic/hybrid via the local MiniLM embedding service (best-effort, keyword fallback).
 */

import type { MemoryBankEntry, PipelineStage } from '../../features/proForge/types';

const MEMORY_BANK_STORE = 'proforge-memory-bank';
const MEMORY_BANK_VERSION = 1;

// ---------------------------------------------------------------------------
// IndexedDB Setup
// ---------------------------------------------------------------------------

interface MemoryBankDb extends IDBDatabase {
  // branded type for clarity
}

let dbPromise: Promise<MemoryBankDb> | null = null;

function openMemoryBankDb(): Promise<MemoryBankDb> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(MEMORY_BANK_STORE, MEMORY_BANK_VERSION);
    request.onerror = () => reject(new Error('Failed to open Memory Bank DB'));
    request.onsuccess = () => resolve(request.result as MemoryBankDb);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('projectId_category', ['projectId', 'category'], { unique: false });
      }
    };
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export async function saveMemoryEntry(
  entry: Omit<MemoryBankEntry, 'id' | 'createdAt'> & { id?: string },
): Promise<MemoryBankEntry> {
  const db = await openMemoryBankDb();
  const fullEntry: MemoryBankEntry = {
    ...entry,
    id: entry.id ?? `${entry.projectId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    const request = store.put(fullEntry);
    request.onsuccess = () => resolve(fullEntry);
    request.onerror = () => reject(new Error('Failed to save memory entry'));
  });
}

export async function getMemoryEntries(
  projectId: string,
  category?: MemoryBankEntry['category'],
): Promise<MemoryBankEntry[]> {
  const db = await openMemoryBankDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');
    const index = category ? store.index('projectId_category') : store.index('projectId');
    const key = category ? IDBKeyRange.only([projectId, category]) : IDBKeyRange.only(projectId);
    const request = index.openCursor(key);
    const results: MemoryBankEntry[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value as MemoryBankEntry);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(new Error('Failed to read memory entries'));
  });
}

export type MemoryRagMode = 'lexical' | 'semantic' | 'hybrid';

function keywordScorer(query: string): (entry: MemoryBankEntry) => number {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 2);
  return (entry) => {
    const text = `${entry.key} ${entry.content}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) if (text.includes(kw)) score += 1;
    return score;
  };
}

function rankByKeyword(
  entries: MemoryBankEntry[],
  query: string,
  limit: number,
): MemoryBankEntry[] {
  const score = keywordScorer(query);
  return entries
    .map((entry) => ({ entry, score: score(entry) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}

export async function searchMemoryEntries(
  projectId: string,
  query: string,
  limit = 10,
  mode: MemoryRagMode = 'lexical',
): Promise<MemoryBankEntry[]> {
  const entries = await getMemoryEntries(projectId);
  if (entries.length === 0) return [];

  if (mode === 'lexical') {
    return rankByKeyword(entries, query, limit);
  }

  // QNBS-v3: Semantic/hybrid recall — best-effort. The embedding service is dynamically imported
  // so the memory bank stays light in node tests, and ANY failure (no model, offline) falls back
  // to keyword ranking rather than breaking the pipeline.
  try {
    const { embedText, cosineSimilarity } = await import('../ai/localEmbeddingService');
    const scoreKeyword = keywordScorer(query);
    const maxKw = Math.max(1, ...entries.map(scoreKeyword));
    const qVec = await embedText(query);
    const scored = await Promise.all(
      entries.map(async (entry) => {
        // QNBS-v3: stored embeddings are persisted as number[]; coerce to the Float32Array the
        // similarity fn expects. Falls back to computing the embedding when none is stored.
        const eVec =
          entry.embedding != null
            ? new Float32Array(entry.embedding)
            : await embedText(`${entry.key} ${entry.content}`);
        const sim = cosineSimilarity(qVec, eVec);
        // QNBS-v3: hybrid blends semantic (0.7) with normalised keyword overlap (0.3).
        const score = mode === 'semantic' ? sim : 0.7 * sim + 0.3 * (scoreKeyword(entry) / maxKw);
        return { entry, score };
      }),
    );
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  } catch {
    return rankByKeyword(entries, query, limit);
  }
}

export async function deleteMemoryEntry(id: string): Promise<void> {
  const db = await openMemoryBankDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to delete memory entry'));
  });
}

export async function clearProjectMemory(projectId: string): Promise<void> {
  const entries = await getMemoryEntries(projectId);
  await Promise.all(entries.map((e) => deleteMemoryEntry(e.id)));
}

// ---------------------------------------------------------------------------
// Agent-Facing API
// ---------------------------------------------------------------------------

export class ProForgeMemoryBank {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  async remember(
    category: MemoryBankEntry['category'],
    key: string,
    content: string,
    sourceStage: PipelineStage,
  ): Promise<MemoryBankEntry> {
    return saveMemoryEntry({
      projectId: this.projectId,
      category,
      key,
      content,
      sourceStage,
    });
  }

  async recall(category?: MemoryBankEntry['category']): Promise<MemoryBankEntry[]> {
    return getMemoryEntries(this.projectId, category);
  }

  async search(
    query: string,
    limit = 10,
    mode: MemoryRagMode = 'lexical',
  ): Promise<MemoryBankEntry[]> {
    return searchMemoryEntries(this.projectId, query, limit, mode);
  }

  async recallForStage(stage: PipelineStage): Promise<MemoryBankEntry[]> {
    const all = await this.recall();
    // Return entries from previous stages plus lore/character entries
    const stageOrder = [
      'idle',
      'intake',
      'structural',
      'lineProse',
      'copyEdit',
      'proof',
      'production',
      'publishing',
      'analytics',
      'archived',
    ];
    const currentIdx = stageOrder.indexOf(stage);
    return all.filter((e) => {
      const entryIdx = stageOrder.indexOf(e.sourceStage);
      return entryIdx < currentIdx || e.category === 'lore' || e.category === 'character';
    });
  }

  async clear(): Promise<void> {
    return clearProjectMemory(this.projectId);
  }

  /**
   * Build a context string for prompt injection from relevant memory entries.
   */
  async buildContextString(
    stage: PipelineStage,
    query?: string,
    maxChars = 4000,
    mode: MemoryRagMode = 'lexical',
  ): Promise<string> {
    let entries: MemoryBankEntry[];
    if (query) {
      entries = await this.search(query, 20, mode);
    } else {
      entries = await this.recallForStage(stage);
    }

    if (entries.length === 0) return '';

    let context = '=== MEMORY BANK CONTEXT ===\n';
    let used = context.length;

    for (const entry of entries) {
      const block = `[${entry.category.toUpperCase()} · ${entry.key}]\n${entry.content}\n\n`;
      if (used + block.length > maxChars) break;
      context += block;
      used += block.length;
    }

    return context;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory per project
// ---------------------------------------------------------------------------

const bankCache = new Map<string, ProForgeMemoryBank>();

export function getMemoryBank(projectId: string): ProForgeMemoryBank {
  if (!bankCache.has(projectId)) {
    bankCache.set(projectId, new ProForgeMemoryBank(projectId));
  }
  return bankCache.get(projectId)!;
}

export function clearMemoryBankCache(): void {
  bankCache.clear();
}

/** Reset DB connection and singleton cache — test-only. Allows fresh IDBFactory per test. */
export function _resetDbForTest(): void {
  dbPromise = null;
  bankCache.clear();
}
