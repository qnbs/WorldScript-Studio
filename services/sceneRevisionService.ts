// QNBS-v3: Standalone IDB for scene revisions — avoids bumping the shared DB_VERSION in dbService.ts.
//          Max 50 revisions per scene; oldest are evicted automatically on save.
import type { SceneRevision } from '../types';

const DB_NAME = 'worldscript-revisions-db';
const DB_VERSION = 1;
const STORE = 'scene-revisions';
const MAX_PER_SCENE = 50;

let _db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sectionId', 'sectionId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Saves a scene revision. Evicts the oldest if max is exceeded. */
export async function saveRevision(
  sectionId: string,
  snapshot: { title: string; content: string },
  label?: string,
  authorName?: string,
): Promise<SceneRevision> {
  const db = await getDb();
  const revision: SceneRevision = {
    id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sectionId,
    createdAt: Date.now(),
    title: snapshot.title,
    content: snapshot.content,
    wordCount: snapshot.content.split(/\s+/).filter(Boolean).length,
    ...(label !== undefined && { label }),
    ...(authorName !== undefined && { authorName }),
  };

  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  store.add(revision);

  // Evict if over MAX_PER_SCENE
  const existing = await listRevisions(sectionId);
  if (existing.length > MAX_PER_SCENE) {
    const toEvict = existing.slice(MAX_PER_SCENE);
    const evictTx = db.transaction(STORE, 'readwrite');
    const evictStore = evictTx.objectStore(STORE);
    for (const r of toEvict) evictStore.delete(r.id);
  }

  return revision;
}

/** Returns revisions for a section, ordered newest-first. */
export async function listRevisions(sectionId: string): Promise<SceneRevision[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('sectionId');
    const req = idx.getAll(sectionId);
    req.onsuccess = () => {
      const all = (req.result as SceneRevision[]).sort((a, b) => b.createdAt - a.createdAt);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Deletes a single revision by ID. */
export async function deleteRevision(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Reset the singleton (for testing). */
export function _resetDbForTest(): void {
  _db = null;
}
