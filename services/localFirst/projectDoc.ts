// services/localFirst/projectDoc.ts
//
// QNBS-v3: B0.1 — Local-First CRDT PoC (strategic plan §5). The decision gate for the
// Y.Doc-as-source-of-truth migration: does a Yjs document faithfully represent ProjectData AND
// deliver the wins that justify the rearchitecture (char-level merge, single undo model)?
//
// This module is a *pure* mapping layer — no runtime wiring, no persistence, no feature flag yet.
// It is exercised only by tests/unit/localFirst/projectDoc.test.ts. The shadow-doc binding into the
// listener middleware (behind `enableLocalFirstSync`) and y-indexeddb persistence are deferred to
// Phase 1 (B1.1) so this PoC stays small and verifiable.
//
// Schema (one Y.Doc per project):
//   manuscript  → Y.Array<Y.Map>   (one map per StorySection; `content` is a Y.Text for char-merge)
//   characters  → Y.Map<id, plain> (EntityState rebuilt via charactersAdapter on read)
//   worlds      → Y.Map<id, plain> (EntityState rebuilt via worldsAdapter on read)
//   meta        → Y.Map            (every other ProjectData field: title, logline, outline, goals…)

import * as Y from 'yjs';
import { charactersAdapter, worldsAdapter } from '../../features/project/adapters';
import type { ProjectData } from '../../features/project/projectState';
import type { Character, StorySection, World } from '../../types';

const MANUSCRIPT = 'manuscript';
const CHARACTERS = 'characters';
const WORLDS = 'worlds';
const META = 'meta';
const CONTENT_KEY = 'content';

/** structuredClone detaches values from immer-frozen Redux state before they enter the CRDT. */
function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function writeEntities(yMap: Y.Map<unknown>, entities: ReadonlyArray<{ id: string }>): void {
  yMap.clear();
  for (const entity of entities) {
    yMap.set(entity.id, cloneJson(entity));
  }
}

function readEntities<T>(yMap: Y.Map<unknown>): T[] {
  const out: T[] = [];
  yMap.forEach((value) => {
    out.push(value as T);
  });
  return out;
}

/**
 * Populate (or repopulate) a Y.Doc from a ProjectData snapshot. Runs in a single transaction so the
 * whole load is one atomic update — important for the future shadow-write path.
 */
export function applyProjectDataToDoc(doc: Y.Doc, project: ProjectData): void {
  doc.transact(() => {
    // --- manuscript: Y.Array<Y.Map>, content as Y.Text ---
    const yManuscript = doc.getArray<Y.Map<unknown>>(MANUSCRIPT);
    yManuscript.delete(0, yManuscript.length);
    for (const section of project.manuscript) {
      const ySection = new Y.Map<unknown>();
      yManuscript.push([ySection]); // integrate the map before mutating it
      for (const [key, value] of Object.entries(section)) {
        if (key === CONTENT_KEY) {
          const text = new Y.Text();
          ySection.set(CONTENT_KEY, text); // integrate the text before inserting
          if (typeof value === 'string' && value.length > 0) {
            text.insert(0, value);
          }
        } else if (value !== undefined) {
          ySection.set(key, cloneJson(value));
        }
      }
      if (!ySection.has(CONTENT_KEY)) {
        ySection.set(CONTENT_KEY, new Y.Text());
      }
    }

    // --- characters / worlds: EntityState → Y.Map keyed by id ---
    writeEntities(
      doc.getMap(CHARACTERS),
      Object.values(project.characters.entities) as Character[],
    );
    writeEntities(doc.getMap(WORLDS), Object.values(project.worlds.entities) as World[]);

    // --- meta: every remaining ProjectData field ---
    const yMeta = doc.getMap(META);
    yMeta.clear();
    for (const [key, value] of Object.entries(project)) {
      if (key === MANUSCRIPT || key === CHARACTERS || key === WORLDS) continue;
      if (value !== undefined) {
        yMeta.set(key, cloneJson(value));
      }
    }
  });
}

/** Build a fresh Y.Doc that mirrors the given project. */
export function createProjectDoc(project: ProjectData): Y.Doc {
  const doc = new Y.Doc();
  applyProjectDataToDoc(doc, project);
  return doc;
}

/** Read a Y.Doc back into a ProjectData snapshot — the inverse of {@link applyProjectDataToDoc}. */
export function readProjectDoc(doc: Y.Doc): ProjectData {
  const yManuscript = doc.getArray<Y.Map<unknown>>(MANUSCRIPT);
  const manuscript: StorySection[] = [];
  for (let i = 0; i < yManuscript.length; i++) {
    const ySection = yManuscript.get(i);
    if (!ySection) continue;
    const section: Record<string, unknown> = {};
    ySection.forEach((value, key) => {
      section[key] = value instanceof Y.Text ? value.toString() : value;
    });
    manuscript.push(section as unknown as StorySection);
  }

  const characters = charactersAdapter.addMany(
    charactersAdapter.getInitialState(),
    readEntities<Character>(doc.getMap(CHARACTERS)),
  );
  const worlds = worldsAdapter.addMany(
    worldsAdapter.getInitialState(),
    readEntities<World>(doc.getMap(WORLDS)),
  );

  const meta: Record<string, unknown> = {};
  doc.getMap(META).forEach((value, key) => {
    meta[key] = value;
  });

  return { ...meta, manuscript, characters, worlds } as unknown as ProjectData;
}

/**
 * Undo manager scoped to the manuscript array (and its Y.Text descendants). `captureTimeout: 0`
 * makes every edit its own undo step — deterministic for tests and the basis for replacing
 * redux-undo with a single CRDT-native history at the Phase-2 flip.
 */
export function createManuscriptUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager(doc.getArray(MANUSCRIPT), { captureTimeout: 0 });
}

/** Convenience accessor: the Y.Text for a section by id (null if absent) — used by tests/binding. */
export function getSectionText(doc: Y.Doc, sectionId: string): Y.Text | null {
  const yManuscript = doc.getArray<Y.Map<unknown>>(MANUSCRIPT);
  for (let i = 0; i < yManuscript.length; i++) {
    const ySection = yManuscript.get(i);
    if (ySection?.get('id') === sectionId) {
      const content = ySection.get(CONTENT_KEY);
      return content instanceof Y.Text ? content : null;
    }
  }
  return null;
}
