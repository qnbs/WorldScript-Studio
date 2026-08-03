/**
 * Privacy-preserving project search index backed by IndexedDB.
 * Descriptive metadata is encrypted when at-rest encryption is configured; only routing fields
 * remain plaintext. The optional DuckDB analytics mirror retains its documented metadata boundary.
 */
import type { ProjectData } from '../features/project/projectSlice';
import type { Character } from '../types';
import { cosineSimilarity, embedText } from './ai/localEmbeddingService';
import { DATA_DB_NAME, DB_VERSION, PROJECTS_INDEX_STORE } from './dbConstants';
import { loadDuckdbAnalytics } from './duckdb/duckdbListenerLoader';
import {
  assertSecureStorageWritableForMutation,
  isSecureRecordEnvelope,
  prepareSecureRecordPayload,
  prepareSecureRecordPayloadWithKey,
  readSecureRecordPayload,
  reEncryptSecureRecordEnvelope,
  type SecureRecordEnvelope,
} from './storage/storageEncryptionService';

const SECURE_STORE = 'projects-index';

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

const RECORD_SCHEMA_VERSION = 1;

type ProjectSearchPayload = Omit<ProjectSearchIndex, 'projectId' | 'lastIndexed'>;

interface StoredProjectSearchIndex {
  projectId: string;
  lastIndexed: number;
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  payload: ProjectSearchPayload | SecureRecordEnvelope;
}

// QNBS-v3: Own connection to data-db — avoids circular import with dbService singleton.
//          IDB handles concurrent same-version opens gracefully; no upgrade runs again.
let dbPromise: Promise<IDBDatabase> | null = null;
let dbHandle: IDBDatabase | null = null;

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
      req.onsuccess = () => {
        dbHandle = req.result;
        dbHandle.onversionchange = () => {
          dbHandle?.close();
          dbHandle = null;
          dbPromise = null;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function projectSearchPayload(record: ProjectSearchIndex): ProjectSearchPayload {
  return {
    title: record.title,
    logline: record.logline,
    manuscriptWordCount: record.manuscriptWordCount,
    characterNames: record.characterNames,
    ...(record.aiSummary !== undefined && { aiSummary: record.aiSummary }),
    ...(record.embeddingVector !== undefined && { embeddingVector: record.embeddingVector }),
  };
}

async function encodeProjectSearchIndex(
  record: ProjectSearchIndex,
): Promise<StoredProjectSearchIndex> {
  return {
    projectId: record.projectId,
    lastIndexed: record.lastIndexed,
    schemaVersion: RECORD_SCHEMA_VERSION,
    payload: await prepareSecureRecordPayload(projectSearchPayload(record), {
      store: SECURE_STORE,
      recordId: record.projectId,
    }),
  };
}

async function decodeProjectSearchIndex(
  stored: StoredProjectSearchIndex | ProjectSearchIndex,
): Promise<{ record: ProjectSearchIndex; needsMigration: boolean }> {
  const recordId = stored.projectId;
  const context = { store: SECURE_STORE, recordId };
  if ('payload' in stored) {
    const decoded = await readSecureRecordPayload<ProjectSearchPayload>(stored.payload, context);
    return {
      record: {
        projectId: stored.projectId,
        lastIndexed: stored.lastIndexed,
        ...decoded.value,
      },
      needsMigration: decoded.needsMigration,
    };
  }

  const decoded = await readSecureRecordPayload<ProjectSearchPayload>(
    projectSearchPayload(stored),
    context,
  );
  return {
    record: {
      projectId: stored.projectId,
      lastIndexed: stored.lastIndexed,
      ...decoded.value,
    },
    needsMigration: decoded.needsMigration,
  };
}

async function putProjectSearchIndexes(
  db: IDBDatabase,
  records: StoredProjectSearchIndex[],
): Promise<void> {
  if (records.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_INDEX_STORE, 'readwrite');
    const store = transaction.objectStore(PROJECTS_INDEX_STORE);
    for (const record of records) store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
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
export async function indexProject(
  projectId: string,
  data: ProjectData,
  // QNBS-v3: P3 dual-write — metadata mirrored to DuckDB when analytics persistence is allowed.
  // SEC: accepts a callback so the caller can re-evaluate the privacy gate at the write site (this
  // function awaits IDB work first) — a boolean captured up-front could go stale on a mid-call opt-out.
  duckDbEnabled: boolean | (() => boolean) = false,
): Promise<void> {
  const record: ProjectSearchIndex = {
    projectId,
    title: (data.title ?? '').slice(0, 256),
    logline: (data.logline ?? '').slice(0, 512),
    manuscriptWordCount: countWords(data),
    characterNames: extractCharacterNames(data).slice(0, 50),
    lastIndexed: Date.now(),
  };
  // QNBS-v3: Encrypt before opening IDB so WebCrypto cannot outlive the write transaction.
  const stored = await encodeProjectSearchIndex(record);
  const db = await getDb();
  await putProjectSearchIndexes(db, [stored]);

  // SEC: normalize to a gate function and re-evaluate it INSIDE the async write chain — both after the
  // IDB put AND after the dynamic loadDuckdbAnalytics() import — so a mid-call opt-out is honoured at
  // the actual write, not merely at entry.
  const gateAllows: () => boolean =
    typeof duckDbEnabled === 'function' ? duckDbEnabled : () => duckDbEnabled;
  if (gateAllows()) {
    void loadDuckdbAnalytics()
      .then(({ duckdbCrossProjectWrite }) => {
        if (!gateAllows()) return undefined;
        return duckdbCrossProjectWrite({
          projectId,
          title: record.title,
          logline: record.logline,
          manuscriptWordCount: record.manuscriptWordCount,
          characterNames: record.characterNames,
        });
      })
      .catch(() => {});
  }
}

/** Return all indexed project records, sorted by lastIndexed descending. */
export async function listIndexedProjects(): Promise<ProjectSearchIndex[]> {
  const db = await getDb();
  const raw = await new Promise<Array<StoredProjectSearchIndex | ProjectSearchIndex>>(
    (resolve, reject) => {
      const tx = db.transaction(PROJECTS_INDEX_STORE, 'readonly');
      const req = tx.objectStore(PROJECTS_INDEX_STORE).getAll();
      req.onsuccess = () =>
        resolve(req.result as Array<StoredProjectSearchIndex | ProjectSearchIndex>);
      req.onerror = () => reject(req.error);
    },
  );

  const records: ProjectSearchIndex[] = [];
  const migrations: StoredProjectSearchIndex[] = [];
  // QNBS-v3: Sequential decrypts keep large embedding collections within a stable memory bound.
  for (const stored of raw) {
    const decoded = await decodeProjectSearchIndex(stored);
    records.push(decoded.record);
    if (decoded.needsMigration) {
      migrations.push(await encodeProjectSearchIndex(decoded.record));
    }
  }
  await putProjectSearchIndexes(db, migrations);
  return records.sort((a, b) => b.lastIndexed - a.lastIndexed);
}

/** Remove a project from the index (call on project deletion). */
export async function removeProjectIndex(projectId: string): Promise<void> {
  await assertSecureStorageWritableForMutation();
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
export async function enrichProjectIndex(
  projectId: string,
  // SEC: callback form re-evaluates the privacy gate at the write site (after async embedding + IDB).
  duckDbEnabled: boolean | (() => boolean) = false,
): Promise<void> {
  const db = await getDb();

  const stored = await new Promise<StoredProjectSearchIndex | ProjectSearchIndex | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(PROJECTS_INDEX_STORE, 'readonly');
      const req = tx.objectStore(PROJECTS_INDEX_STORE).get(projectId);
      req.onsuccess = () =>
        resolve(req.result as StoredProjectSearchIndex | ProjectSearchIndex | undefined);
      req.onerror = () => reject(req.error);
    },
  );

  if (!stored) return;
  const decoded = await decodeProjectSearchIndex(stored);
  const record = decoded.record;
  if (decoded.needsMigration) {
    await putProjectSearchIndexes(db, [await encodeProjectSearchIndex(record)]);
  }

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

  await putProjectSearchIndexes(db, [await encodeProjectSearchIndex(enriched)]);

  // QNBS-v3: P3 — update DuckDB entry with the now-computed embedding vector.
  // SEC: re-evaluate the gate INSIDE the async chain — after the embedding + IDB put AND after the
  // dynamic loadDuckdbAnalytics() import — so a mid-call opt-out is honoured at the actual write.
  const gateAllows: () => boolean =
    typeof duckDbEnabled === 'function' ? duckDbEnabled : () => duckDbEnabled;
  if (gateAllows()) {
    void loadDuckdbAnalytics()
      .then(({ duckdbCrossProjectWrite }) => {
        if (!gateAllows()) return undefined;
        return duckdbCrossProjectWrite({
          projectId,
          title: enriched.title,
          logline: enriched.logline,
          manuscriptWordCount: enriched.manuscriptWordCount,
          characterNames: enriched.characterNames,
          embeddingVector: embedding,
        });
      })
      .catch(() => {});
  }
}

/**
 * Semantic search over all indexed projects using embedding similarity.
 * Falls back to keyword match on `title + logline` when no embedding stored.
 * When duckDbEnabled=true and embedding is available, delegates ranking to DuckDB.
 */
export async function semanticSearchProjects(
  query: string,
  topK = 5,
  // QNBS-v3: P3 — DuckDB list_dot_product replaces JS cosine loop when analytics flag is on.
  duckDbEnabled = false,
): Promise<ProjectSearchIndex[]> {
  let queryEmbedding: Float32Array | null = null;
  try {
    queryEmbedding = await embedText(query);
  } catch {
    // QNBS-v3: Graceful degrade — keyword fallback below.
  }

  // DuckDB path: skip IDB load when embedding available; DuckDB does the ranking.
  if (duckDbEnabled && queryEmbedding) {
    const { queryCrossProjectSearch } = await loadDuckdbAnalytics();
    const rows = await queryCrossProjectSearch(queryEmbedding, topK);
    if (rows.length > 0) {
      return rows.map((r) => ({
        projectId: r.project_id,
        title: r.title,
        logline: r.logline,
        manuscriptWordCount: r.manuscript_word_count,
        characterNames: r.character_names,
        lastIndexed: r.last_indexed ? new Date(r.last_indexed).getTime() : Date.now(),
      }));
    }
    // Fall through to IDB path when DuckDB has no entries yet.
  }

  const all = await listIndexedProjects();
  if (!all.length) return [];

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

/** Close the cached connection so tests can install a fresh IDBFactory. */
export function _resetCrossProjectIndexDbForTest(): void {
  dbHandle?.close();
  dbHandle = null;
  dbPromise = null;
}

/** Decrypt all index payloads to plaintext before encryption is disabled. */
export async function migrateCrossProjectIndexForDisable(): Promise<void> {
  const db = await getDb();
  const raw = await new Promise<StoredProjectSearchIndex[]>((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readonly');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredProjectSearchIndex[]);
    req.onerror = () => reject(req.error);
  });
  const plaintext: StoredProjectSearchIndex[] = [];
  for (const stored of raw) {
    const decoded = await decodeProjectSearchIndex(stored);
    plaintext.push({
      projectId: decoded.record.projectId,
      lastIndexed: decoded.record.lastIndexed,
      schemaVersion: RECORD_SCHEMA_VERSION,
      payload: projectSearchPayload(decoded.record),
    });
  }
  await putProjectSearchIndexes(db, plaintext);
}

/** Re-encrypt all index payloads during passphrase rotation. */
export async function reEncryptCrossProjectIndex(
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  const db = await getDb();
  const raw = await new Promise<StoredProjectSearchIndex[]>((resolve, reject) => {
    const tx = db.transaction(PROJECTS_INDEX_STORE, 'readonly');
    const req = tx.objectStore(PROJECTS_INDEX_STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredProjectSearchIndex[]);
    req.onerror = () => reject(req.error);
  });
  const migrated: StoredProjectSearchIndex[] = [];
  for (const stored of raw) {
    const context = { store: SECURE_STORE, recordId: stored.projectId };
    if (isSecureRecordEnvelope(stored.payload)) {
      migrated.push({
        ...stored,
        payload: await reEncryptSecureRecordEnvelope(stored.payload, context, oldKey, newKey),
      });
    } else {
      migrated.push({
        ...stored,
        payload: await prepareSecureRecordPayloadWithKey(
          stored.payload as ProjectSearchPayload,
          context,
          newKey,
        ),
      });
    }
  }
  await putProjectSearchIndexes(db, migrated);
}
