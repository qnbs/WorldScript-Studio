// tests/unit/localFirst/projectDoc.test.ts
//
// QNBS-v3: B0.1 decision-gate proofs for the Y.Doc-as-source-of-truth migration (strategic plan §5,
// §8). These tests answer the three questions the gate hinges on:
//   1. Fidelity   — does ProjectData survive a Y.Doc round-trip unchanged?
//   2. Merge      — do CONCURRENT edits to the SAME paragraph converge (char-level CRDT)? (the win)
//   3. Undo       — does Y.UndoManager give a coherent, redux-undo-replacing history?
// If these pass, the migration is evidence-backed; if not, hold at the shadow-doc stage (per §7).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyProjectDataToDoc,
  createManuscriptUndoManager,
  createProjectDoc,
  getSectionText,
  readProjectDoc,
} from '../../../services/localFirst/projectDoc';
import { buildLargeManuscript } from '../../bench/fixtures/largeManuscript';

// Small but representative deterministic project (reuses the A0.1 fixture builder at tiny scale).
function smallProject() {
  return buildLargeManuscript({
    sectionCount: 3,
    wordsPerSection: 20,
    characterCount: 2,
    worldCount: 1,
  });
}

/** Two-way Yjs sync via state vectors — the canonical "exchange updates between peers" pattern. */
function sync(a: Y.Doc, b: Y.Doc): void {
  const updateForB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const updateForA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, updateForB);
  Y.applyUpdate(a, updateForA);
}

describe('B0.1 — ProjectData ↔ Y.Doc PoC', () => {
  describe('fidelity: round-trip', () => {
    it('preserves meta, manuscript, characters and worlds', () => {
      const project = smallProject();
      const restored = readProjectDoc(createProjectDoc(project));

      expect(restored.title).toBe(project.title);
      expect(restored.logline).toBe(project.logline);
      expect(restored.author).toBe(project.author);
      expect(restored.projectGoals).toEqual(project.projectGoals);

      expect(restored.manuscript).toHaveLength(project.manuscript.length);
      project.manuscript.forEach((section, i) => {
        const r = restored.manuscript[i];
        expect(r?.id).toBe(section.id);
        expect(r?.title).toBe(section.title);
        expect(r?.content).toBe(section.content);
        expect(r?.act).toBe(section.act);
        expect(r?.status).toBe(section.status);
        expect(r?.wordCount).toBe(section.wordCount);
      });

      expect(restored.characters.ids).toEqual(project.characters.ids);
      expect(restored.characters.entities).toEqual(project.characters.entities);
      expect(restored.worlds.entities).toEqual(project.worlds.entities);
    });

    it('round-trips an empty-content section to an empty string (not undefined)', () => {
      const project = smallProject();
      const first = project.manuscript[0];
      if (first) first.content = '';
      const restored = readProjectDoc(createProjectDoc(project));
      expect(restored.manuscript[0]?.content).toBe('');
    });

    it('applyProjectDataToDoc replaces prior manuscript state (no duplication on reload)', () => {
      const doc = new Y.Doc();
      applyProjectDataToDoc(doc, smallProject());
      applyProjectDataToDoc(doc, smallProject());
      expect(readProjectDoc(doc).manuscript).toHaveLength(3);
    });
  });

  describe('merge: concurrent edits converge', () => {
    it('CHAR-LEVEL — two peers editing the same section converge and keep BOTH edits', () => {
      const docA = createProjectDoc(smallProject());
      const docB = new Y.Doc();
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA)); // B starts as a clone of A

      const sectionId = readProjectDoc(docA).manuscript[0]?.id ?? 'sec-0';
      const aText = getSectionText(docA, sectionId);
      const bText = getSectionText(docB, sectionId);
      expect(aText).not.toBeNull();
      expect(bText).not.toBeNull();

      // Concurrent edits at different offsets — the exact case a string LWW model would lose.
      aText?.insert(aText.length, ' [A-EDIT]');
      bText?.insert(0, '[B-EDIT] ');

      sync(docA, docB);

      const aFinal = getSectionText(docA, sectionId)?.toString() ?? '';
      const bFinal = getSectionText(docB, sectionId)?.toString() ?? '';
      expect(aFinal).toBe(bFinal); // converged
      expect(aFinal).toContain('[A-EDIT]');
      expect(aFinal).toContain('[B-EDIT]'); // neither edit lost
    });

    it('SECTION-LEVEL — peers editing different sections both retain their changes', () => {
      const docA = createProjectDoc(smallProject());
      const docB = new Y.Doc();
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

      (docA.getArray('manuscript').get(0) as Y.Map<unknown>).set('title', 'A renamed ch1');
      (docB.getArray('manuscript').get(1) as Y.Map<unknown>).set('title', 'B renamed ch2');

      sync(docA, docB);

      // Assert BOTH peers converged on BOTH edits (true two-way convergence, not one-sided).
      const manuscriptA = readProjectDoc(docA).manuscript;
      const manuscriptB = readProjectDoc(docB).manuscript;
      expect(manuscriptA[0]?.title).toBe('A renamed ch1');
      expect(manuscriptA[1]?.title).toBe('B renamed ch2');
      expect(manuscriptB[0]?.title).toBe('A renamed ch1');
      expect(manuscriptB[1]?.title).toBe('B renamed ch2');
    });
  });

  describe('undo: Y.UndoManager replaces redux-undo', () => {
    it('undoes and redoes a section content edit', () => {
      const doc = createProjectDoc(smallProject());
      const sectionId = readProjectDoc(doc).manuscript[0]?.id ?? 'sec-0';
      const undo = createManuscriptUndoManager(doc); // created BEFORE the edit so it captures it

      const text = getSectionText(doc, sectionId);
      const before = text?.toString() ?? '';
      text?.insert(text.length, ' APPENDED');
      expect(getSectionText(doc, sectionId)?.toString()).toContain('APPENDED');

      undo.undo();
      expect(getSectionText(doc, sectionId)?.toString()).toBe(before);

      undo.redo();
      expect(getSectionText(doc, sectionId)?.toString()).toContain('APPENDED');
    });
  });
});
