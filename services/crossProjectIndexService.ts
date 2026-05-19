/**
 * Privacy-preserving project search index backed by IndexedDB.
 * Stores only metadata (title, logline, character names, word count) —
 * never manuscript plaintext.
 */
import type { ProjectData } from '../features/project/projectSlice';
import type { Character } from '../types';
import { cosineSimilarity, embedText } from './ai/localEmbeddingService';
import { DATA_DB_NAME, DB_VERSION, PROJECTS_INDEX_STORE } from './dbConstants';

export interface ProjectSearchIndex {
  projectId: string;
  title: string;
  logline: string;
  manuscriptWordCount: number;
  characterNames: string[];
  lastIndexed: number;
  // QNBS-v3: AI-generated 100-char summary for semantic search; absent when model not loaded.
  aiSummary?: string;
  /** Serialised Float32Array (Array<number>) for semantic search — stored lazily. */
  embeddingVector?: number[];
}

// QNBS-v3: Own connection to data-db — avoids circular import with dbService singleton.
//          IDB handles concurrent same-version opens gracefully; no upgrade runs again.
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DATA_DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        // QNBS-v3: Upgrade handled by dbService; this connection should never need it.
        //          If reached (first open before dbService), store is created here too.
        const db = req.result;
        if (!db.objectStoreNames.contains(PROJECTS_INDEX_STORE)) {
          const store = db.createObjectStore(PROJECTS_INDEX_STORE, { keyPath: 'projectId' });
          store.createIndex('lastIndexed', 'lastIndexed', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function extractCharacterNames(data: ProjectData): string[] {
  const { characters } = data;
  if (!characters) return [];
  if (Array.isArray(characters)) {
    return (characters as Character[]).map((c) => c.name).filter(Boolean);
  }
  return (characters.ids as string[])
    .map((id) => (characters.entities as Record<string, Character>)[id]?.name)
    .filter((n): n is string => Boolean(n));
}

function countWords(data: ProjectData): number {
  const sections = data.manuscript ?? [];
  return sections.reduce((sum, s) => {
    const words = (s.content ?? '').trim().split(/\s+/).filter(Boolean).length;
    return sum + words;
  }, 0);
}

/** Persist a project's index record. Creates or replaces the entry for projectId. */
export async function indexProject(projectId: string, data: ProjectData): Promise<void> {
  const db = await getDb();

  const record: ProjectSearchIndex = {
    projectId,
    title: (data.title ?? '').slice(0, 256),
    logline: (data.logline ?? '').slice(0, 512),
    manuscriptWordCount: countWords(data),
    characterNames: extractCharacterNames(data).slice(0, 50),
    lastIndexed: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readwrite');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Return all indexed project records, sorted by lastIndexed descending. */
export async function listIndexedProjects(): Promise<ProjectSearchIndex[]> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readonly');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).getAll();
    req.onsuccess = () => {
      const results = (req.result as ProjectSearchIndex[]).sort(
        (a, b) => b.lastIndexed - a.lastIndexed,
      );
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Remove a project from the index (call on project deletion). */
export async function removeProjectIndex(projectId: string): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readwrite');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).delete(projectId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Enrich an existing index record with an AI-generated summary + embedding.
 * QNBS-v3: Feature-gated — only runs when embedding model is available; silently
 *          no-ops if the project is not yet indexed or the model isn't ready.
 */
export async function enrichProjectIndex(projectId: string): Promise<void> {
  const db = await getDb();

  const record = await new Promise<ProjectSearchIndex | undefined>((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readonly');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).get(projectId);
    req.onsuccess = () => resolve(req.result as ProjectSearchIndex | undefined);
    req.onerror = () => reject(req.error);
  });

  if (!record) return;

  // Build a short plaintext synopsis from available metadata (no manuscript text).
  const synopsis = [record.title, record.logline, ...record.characterNames.slice(0, 5)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 512);

  let embedding: Float32Array;
  try {
    embedding = await embedText(synopsis);
  } catch {
    // QNBS-v3: If the embedding worker isn't loaded, skip enrichment silently.
    return;
  }

  const aiSummary = synopsis.slice(0, 100);
  const enriched: ProjectSearchIndex = {
    ...record,
    aiSummary,
    embeddingVector: Array.from(embedding),
    lastIndexed: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readwrite');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).put(enriched);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Semantic search over all indexed projects using embedding similarity.
 * Falls back to keyword match on `title + logline` when no embedding stored.
 */
export async function semanticSearchProjects(
  query: string,
  topK = 5,
): Promise<ProjectSearchIndex[]> {
  const all = await listIndexedProjects();
  if (!all.length) return [];

  let queryEmbedding: Float32Array | null = null;
  try {
    queryEmbedding = await embedText(query);
  } catch {
    // QNBS-v3: Graceful degrade — keyword fallback below.
  }

  const scored = all.map((p) => {
    let score = 0;
    if (queryEmbedding && p.embeddingVector?.length) {
      score = cosineSimilarity(queryEmbedding, new Float32Array(p.embeddingVector));
    } else {
      // Keyword fallback: count query terms found in title/logline
      const q = query.toLowerCase();
      const hay = `${p.title} ${p.logline}`.toLowerCase();
      const terms = q.match(/\p{L}+|\d+/gu) ?? [];
      score = terms.filter((t) => hay.includes(t)).length / (terms.length || 1);
    }
    return { project: p, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.project);
}
