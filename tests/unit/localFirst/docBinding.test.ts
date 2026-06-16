// tests/unit/localFirst/docBinding.test.ts
//
// QNBS-v3: B1.1 binding-seam proofs (strategic plan §4 Phase 1, §5). Beyond B0.1's round-trip, these
// prove the *incremental* write-through is CRDT-friendly: a local section edit applied through the
// binding does NOT clobber the rest of the Y.Text, so a concurrent remote edit in the untouched
// region still merges. That is the property a "rebuild the doc on every save" shadow would destroy.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ProjectData } from '../../../features/project/projectState';
import { ProjectDocBinding } from '../../../services/localFirst/docBinding';
import { getSectionText, readProjectDoc } from '../../../services/localFirst/projectDoc';
import { buildLargeManuscript } from '../../bench/fixtures/largeManuscript';

function smallProject(): ProjectData {
  return buildLargeManuscript({
    sectionCount: 3,
    wordsPerSection: 20,
    characterCount: 2,
    worldCount: 1,
  });
}

function sync(a: Y.Doc, b: Y.Doc): void {
  const updateForB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const updateForA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, updateForB);
  Y.applyUpdate(a, updateForA);
}

describe('B1.1 — ProjectDocBinding (incremental shadow write-through)', () => {
  it('verify() is ok immediately after construction', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    expect(binding.verify(project)).toEqual({ ok: true, mismatches: [] });
  });

  it('incremental content edit preserves Y.Text identity — concurrent remote edit still merges', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    const sectionId = project.manuscript[0]?.id ?? 'sec-0';
    const original = project.manuscript[0]?.content ?? '';

    // Peer B clones the doc, then inserts at the START (the region the local edit leaves untouched).
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(binding.getDoc()));
    getSectionText(docB, sectionId)?.insert(0, '[REMOTE] ');

    // Local edit through the binding: append to the same section (prefix unchanged → splice appends).
    const edited = smallProject();
    const firstEdited = edited.manuscript[0];
    if (firstEdited) firstEdited.content = `${original} [LOCAL]`;
    binding.syncFromProject(edited);

    sync(binding.getDoc(), docB);

    const aContent = getSectionText(binding.getDoc(), sectionId)?.toString() ?? '';
    const bContent = getSectionText(docB, sectionId)?.toString() ?? '';
    expect(aContent).toBe(bContent); // converged
    expect(aContent).toContain('[REMOTE]'); // remote prefix edit survived — identity preserved
    expect(aContent).toContain('[LOCAL]'); // local append applied
  });

  it('appends a new section incrementally and verifies', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);

    const next = smallProject();
    next.manuscript.push({ id: 'sec-new', title: 'Chapter 4', content: 'Fresh chapter.' });
    binding.syncFromProject(next);

    expect(binding.verify(next)).toEqual({ ok: true, mismatches: [] });
    expect(readProjectDoc(binding.getDoc()).manuscript.map((s) => s.id)).toContain('sec-new');
  });

  it('removes a deleted section incrementally and verifies', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);

    const next = smallProject();
    next.manuscript = next.manuscript.filter((s) => s.id !== 'sec-1');
    binding.syncFromProject(next);

    const result = binding.verify(next);
    expect(result.ok).toBe(true);
    expect(readProjectDoc(binding.getDoc()).manuscript.map((s) => s.id)).not.toContain('sec-1');
  });

  it('reorders via the safe full-reprojection fallback and stays faithful', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);

    const next = smallProject();
    next.manuscript = [...next.manuscript].reverse(); // mid-reorder → not incremental-compatible
    binding.syncFromProject(next);

    expect(binding.verify(next)).toEqual({ ok: true, mismatches: [] });
    expect(readProjectDoc(binding.getDoc()).manuscript.map((s) => s.id)).toEqual(
      next.manuscript.map((s) => s.id),
    );
  });

  it('propagates a character field edit', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);

    const next = smallProject();
    const firstCharId = next.characters.ids[0];
    if (typeof firstCharId === 'string') {
      const entity = next.characters.entities[firstCharId];
      // EntityState is immer-frozen — rebuild immutably rather than mutating in place.
      if (entity) {
        next.characters = {
          ...next.characters,
          entities: {
            ...next.characters.entities,
            [firstCharId]: { ...entity, motivation: 'Rewritten motivation.' },
          },
        };
      }
    }
    binding.syncFromProject(next);

    expect(binding.verify(next)).toEqual({ ok: true, mismatches: [] });
  });

  it('verify() reports drift when the doc diverges from the project', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);

    // Mutate the doc out-of-band (not via the binding) → read-verify must catch it.
    binding.getDoc().getMap('meta').set('title', 'Tampered Title');

    const result = binding.verify(project);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('meta.title drift');
  });

  it('observe() fires on doc updates and unsubscribes cleanly', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    let calls = 0;
    const unsubscribe = binding.observe(() => {
      calls += 1;
    });

    const next = smallProject();
    const first = next.manuscript[0];
    if (first) first.content = `${first.content} edit`;
    binding.syncFromProject(next);
    expect(calls).toBeGreaterThan(0);

    const after = calls;
    unsubscribe();
    const next2 = smallProject();
    const first2 = next2.manuscript[0];
    if (first2) first2.content = `${first2.content} again`;
    binding.syncFromProject(next2);
    expect(calls).toBe(after); // no further callbacks after unsubscribe
  });

  it('clears a section field set to undefined (no stale Yjs value)', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    expect(readProjectDoc(binding.getDoc()).manuscript[0]?.status).toBe('first-draft');

    const next = smallProject();
    const first = next.manuscript[0];
    // Explicit-undefined (key present, value undefined) — the exact case the reconcile bug missed.
    if (first) (first as unknown as Record<string, unknown>)['status'] = undefined;
    binding.syncFromProject(next);

    expect(readProjectDoc(binding.getDoc()).manuscript[0]?.status).toBeUndefined();
    expect(binding.verify(next).ok).toBe(true);
  });

  it('clears a meta field set to undefined', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    expect(readProjectDoc(binding.getDoc()).author).toBe('Bench Author');

    const next = smallProject();
    (next as unknown as Record<string, unknown>)['author'] = undefined;
    binding.syncFromProject(next);

    expect(readProjectDoc(binding.getDoc()).author).toBeUndefined();
    expect(binding.verify(next).ok).toBe(true);
  });

  it('verify() detects drift in non-title meta fields (e.g. logline)', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    binding.getDoc().getMap('meta').set('logline', 'tampered logline');

    const result = binding.verify(project);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain('meta.logline drift');
  });

  it('verify() flags a stale meta value left in the doc after the field is cleared', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    // Simulate a stale write-through: a key in the doc that the project no longer defines.
    binding.getDoc().getMap('meta').set('orphanField', 'left over');

    const result = binding.verify(project);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain(
      'meta.orphanField stale (present in doc, undefined in project)',
    );
  });

  it('observe() stamps the binding origin on self-writes (echo filtering)', () => {
    const project = smallProject();
    const binding = new ProjectDocBinding(project);
    const origins: unknown[] = [];
    const unsubscribe = binding.observe((origin) => origins.push(origin));

    const next = smallProject();
    const first = next.manuscript[0];
    if (first) first.content = `${first.content} edited`;
    binding.syncFromProject(next);
    unsubscribe();

    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((o) => o === binding.origin)).toBe(true);
  });
});
