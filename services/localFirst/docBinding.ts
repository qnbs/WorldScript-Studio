// services/localFirst/docBinding.ts
//
// QNBS-v3: B1.1 — the binding seam (strategic plan §4 Phase 1, §5). The migration spine: keeps a
// project Y.Doc in sync with the Redux ProjectData *incrementally*, so a single section edit becomes
// a minimal Y.Text splice rather than a full re-projection. That distinction is the whole point —
// an incremental, identity-preserving write-through stays CRDT-friendly (a concurrent remote edit in
// the untouched region still merges), which a destructive "rebuild the doc every save" approach would
// silently break.
//
// Shadow phase: Redux remains source of truth; this binding write-throughs Redux → doc and offers a
// read-verify (doc → ProjectData, compared against Redux) for the CI fidelity gate. The reverse
// direction (doc → Redux hydrate) is exposed via observe() for the Phase-2 flip but not yet wired.
//
// NOT yet here (deferred to the next increment): the enableLocalFirstSync flag, listenerMiddleware
// wiring, and y-indexeddb persistence. This module is pure and unit-tested in isolation.

import * as Y from 'yjs';
import type { ProjectData } from '../../features/project/projectState';
import type { StorySection } from '../../types';
import { applyProjectDataToDoc, createProjectDoc, readProjectDoc } from './projectDoc';

const MANUSCRIPT = 'manuscript';
const CHARACTERS = 'characters';
const WORLDS = 'worlds';
const META = 'meta';
const CONTENT_KEY = 'content';

export interface VerifyResult {
  ok: boolean;
  /** Human-readable mismatch descriptions — empty when ok. */
  mismatches: string[];
}

/** Minimal common-prefix/suffix splice of a Y.Text toward `next` — preserves identity of unchanged ends. */
function spliceText(ytext: Y.Text, next: string): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const minLen = Math.min(prev.length, next.length);
  let start = 0;
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  const deleteLen = endPrev - start;
  if (deleteLen > 0) ytext.delete(start, deleteLen);
  const insertStr = next.slice(start, endNext);
  if (insertStr.length > 0) ytext.insert(start, insertStr);
}

/** Ids that exist in `a`, in order, restricted to those also in `b`. */
function commonOrder(a: string[], bSet: Set<string>): string[] {
  return a.filter((id) => bSet.has(id));
}

export class ProjectDocBinding {
  private readonly doc: Y.Doc;
  // QNBS-v3 (CodeAnt): stamped on this binding's own transactions so observe() consumers can tell
  // self-generated updates (origin === this.origin) from external ones and skip echoes.
  readonly origin: symbol = Symbol('ProjectDocBinding');

  constructor(initial: ProjectData, doc?: Y.Doc) {
    this.doc = doc ?? createProjectDoc(initial);
    if (doc) applyProjectDataToDoc(doc, initial);
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  private sectionMaps(): Map<string, Y.Map<unknown>> {
    const yManuscript = this.doc.getArray<Y.Map<unknown>>(MANUSCRIPT);
    const byId = new Map<string, Y.Map<unknown>>();
    for (let i = 0; i < yManuscript.length; i++) {
      const m = yManuscript.get(i);
      const id = m?.get('id');
      if (m && typeof id === 'string') byId.set(id, m);
    }
    return byId;
  }

  /**
   * Decide whether `next` is reachable from the current doc by deletions + end-appends only (the typing
   * / add-chapter / delete-chapter cases). Mid-insertions and reorders are NOT — they take the safe
   * full-reprojection path, which sacrifices identity only for the genuinely restructured manuscript.
   */
  private isIncrementalCompatible(nextIds: string[]): boolean {
    const yManuscript = this.doc.getArray<Y.Map<unknown>>(MANUSCRIPT);
    const docIds: string[] = [];
    for (let i = 0; i < yManuscript.length; i++) {
      const id = yManuscript.get(i)?.get('id');
      if (typeof id === 'string') docIds.push(id);
    }
    const nextSet = new Set(nextIds);
    const docSet = new Set(docIds);
    // Common ids must keep the same relative order in both …
    const commonInDoc = commonOrder(docIds, nextSet);
    const commonInNext = commonOrder(nextIds, docSet);
    if (commonInDoc.length !== commonInNext.length) return false;
    for (let i = 0; i < commonInDoc.length; i++) {
      if (commonInDoc[i] !== commonInNext[i]) return false;
    }
    // … and every brand-new id must be appended at the end (no mid-insertion).
    const firstNewIndex = nextIds.findIndex((id) => !docSet.has(id));
    if (firstNewIndex === -1) return true;
    return nextIds.slice(firstNewIndex).every((id) => !docSet.has(id));
  }

  private reconcileSection(ySection: Y.Map<unknown>, section: StorySection): void {
    const sectionKeys = new Set(Object.keys(section));
    for (const [key, value] of Object.entries(section)) {
      if (key === CONTENT_KEY) {
        const text = ySection.get(CONTENT_KEY);
        if (text instanceof Y.Text) {
          spliceText(text, typeof value === 'string' ? value : '');
        }
      } else if (value === undefined) {
        // QNBS-v3 (CodeAnt): a field cleared to undefined must be removed, not left stale. `key in
        // section` stays true for an explicit-undefined property, so the trailing sweep won't catch it.
        ySection.delete(key);
      } else if (JSON.stringify(ySection.get(key)) !== JSON.stringify(value)) {
        ySection.set(key, structuredClone(value));
      }
    }
    // Drop keys removed from the section entirely (content always retained as Y.Text).
    for (const key of [...ySection.keys()]) {
      if (key !== CONTENT_KEY && !sectionKeys.has(key)) ySection.delete(key);
    }
  }

  private reconcileEntities(
    yMap: Y.Map<unknown>,
    entities: Record<string, { id: string } | undefined>,
  ): void {
    const nextIds = new Set(Object.keys(entities));
    for (const key of [...yMap.keys()]) {
      if (!nextIds.has(key)) yMap.delete(key);
    }
    for (const [id, entity] of Object.entries(entities)) {
      if (!entity) continue;
      if (JSON.stringify(yMap.get(id)) !== JSON.stringify(entity)) {
        yMap.set(id, structuredClone(entity));
      }
    }
  }

  private reconcileMeta(project: ProjectData): void {
    const yMeta = this.doc.getMap(META);
    const skip = new Set([MANUSCRIPT, CHARACTERS, WORLDS]);
    // QNBS-v3 (CodeAnt): build nextKeys from keys with a DEFINED value (matching the write loop
    // below), so a field cleared to undefined is dropped from the doc instead of left stale.
    const nextKeys = new Set(
      Object.entries(project)
        .filter(([k, v]) => !skip.has(k) && v !== undefined)
        .map(([k]) => k),
    );
    for (const key of [...yMeta.keys()]) {
      if (!nextKeys.has(key)) yMeta.delete(key);
    }
    for (const [key, value] of Object.entries(project)) {
      if (skip.has(key) || value === undefined) continue;
      if (JSON.stringify(yMeta.get(key)) !== JSON.stringify(value)) {
        yMeta.set(key, structuredClone(value));
      }
    }
  }

  /** Force a full re-projection — the self-heal path when verify() reports drift. */
  reproject(project: ProjectData): void {
    this.doc.transact(() => applyProjectDataToDoc(this.doc, project), this.origin);
  }

  /** Write the current Redux project state into the doc — incrementally where structurally possible. */
  syncFromProject(project: ProjectData): void {
    const nextIds = project.manuscript.map((s) => s.id);
    if (!this.isIncrementalCompatible(nextIds)) {
      this.doc.transact(() => applyProjectDataToDoc(this.doc, project), this.origin);
      return;
    }
    this.doc.transact(() => {
      const yManuscript = this.doc.getArray<Y.Map<unknown>>(MANUSCRIPT);
      const existing = this.sectionMaps();
      const nextSet = new Set(nextIds);

      // Remove deleted sections (iterate from the end so indices stay valid).
      for (let i = yManuscript.length - 1; i >= 0; i--) {
        const id = yManuscript.get(i)?.get('id');
        if (typeof id === 'string' && !nextSet.has(id)) yManuscript.delete(i, 1);
      }

      // Update existing, append new (compatibility guarantees new ids belong at the end).
      for (const section of project.manuscript) {
        const current = existing.get(section.id);
        if (current) {
          this.reconcileSection(current, section);
        } else {
          const ySection = new Y.Map<unknown>();
          yManuscript.push([ySection]);
          for (const [key, value] of Object.entries(section)) {
            if (key === CONTENT_KEY) {
              const text = new Y.Text();
              ySection.set(CONTENT_KEY, text);
              if (typeof value === 'string' && value.length > 0) text.insert(0, value);
            } else if (value !== undefined) {
              ySection.set(key, structuredClone(value));
            }
          }
          if (!ySection.has(CONTENT_KEY)) ySection.set(CONTENT_KEY, new Y.Text());
        }
      }

      this.reconcileEntities(this.doc.getMap(CHARACTERS), project.characters.entities);
      this.reconcileEntities(this.doc.getMap(WORLDS), project.worlds.entities);
      this.reconcileMeta(project);
    }, this.origin);
  }

  /**
   * Read-verify: read the doc back and compare against the Redux project on the load-bearing fields.
   * This is the CI fidelity gate for the shadow phase — drift means the write-through has a bug.
   */
  verify(project: ProjectData): VerifyResult {
    const mismatches: string[] = [];
    const restored = readProjectDoc(this.doc);

    if (restored.manuscript.length !== project.manuscript.length) {
      mismatches.push(
        `manuscript length ${restored.manuscript.length} !== ${project.manuscript.length}`,
      );
    }
    project.manuscript.forEach((section, i) => {
      const r = restored.manuscript[i];
      if (r?.id !== section.id) mismatches.push(`section[${i}] id ${r?.id} !== ${section.id}`);
      if (r?.content !== section.content)
        mismatches.push(`section[${i}] content drift (${section.id})`);
      if (r?.title !== section.title) mismatches.push(`section[${i}] title drift (${section.id})`);
    });

    if (
      JSON.stringify(restored.characters.entities) !== JSON.stringify(project.characters.entities)
    ) {
      mismatches.push('characters drift');
    }
    if (JSON.stringify(restored.worlds.entities) !== JSON.stringify(project.worlds.entities)) {
      mismatches.push('worlds drift');
    }

    // QNBS-v3 (CodeAnt): verify EVERY meta field reconcileMeta() writes (title, logline, author,
    // goals, outline, history…), not just title — otherwise drift in other fields evades self-heal.
    const skip = new Set([MANUSCRIPT, CHARACTERS, WORLDS]);
    const restoredMeta = restored as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(project)) {
      if (skip.has(key) || value === undefined) continue;
      if (JSON.stringify(restoredMeta[key]) !== JSON.stringify(value)) {
        mismatches.push(`meta.${key} drift`);
      }
    }

    return { ok: mismatches.length === 0, mismatches };
  }

  /**
   * Subscribe to doc changes (the future doc → Redux hydrate direction). Returns an unsubscribe fn.
   * For this binding's own writes the update origin is `this.origin`, so a future hydrate can compare
   * `origin === binding.origin` and ignore self-generated echoes.
   */
  observe(listener: (origin: unknown) => void): () => void {
    const handler = (_update: Uint8Array, origin: unknown) => listener(origin);
    this.doc.on('update', handler);
    return () => this.doc.off('update', handler);
  }
}
