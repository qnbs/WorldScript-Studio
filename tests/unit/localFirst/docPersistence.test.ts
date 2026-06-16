// tests/unit/localFirst/docPersistence.test.ts
//
// QNBS-v3: B1.1 — proves the y-indexeddb persistence layer round-trips a Y.Doc across reloads
// (fake-indexeddb in the test env). This is the offline-store half of the shadow binding.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  dbNameForProject,
  isIndexedDbAvailable,
  persistProjectDoc,
} from '../../../services/localFirst/docPersistence';

// Open a fresh provider, read the persisted 'greeting' text, and tear it down. Used to probe what
// has actually reached IndexedDB without depending on wall-clock delays.
// QNBS-v3 (CodeAnt): teardown in `finally` so a throw never leaks the provider / IDB connection.
async function readPersisted(projectId: string): Promise<string> {
  const doc = new Y.Doc();
  const persistence = persistProjectDoc(projectId, doc);
  try {
    await persistence.whenSynced;
    return doc.getText('greeting').toString();
  } finally {
    await persistence.destroy();
  }
}

// QNBS-v3 (CodeAnt): wipe a project's persisted state so a fixed-id test starts from a clean slate
// and can never be satisfied by stale data left by a prior run.
async function clearPersisted(projectId: string): Promise<void> {
  const doc = new Y.Doc();
  const persistence = persistProjectDoc(projectId, doc);
  try {
    await persistence.whenSynced;
    await persistence.clearData();
  } finally {
    await persistence.destroy();
  }
}

describe('B1.1 — docPersistence (y-indexeddb)', () => {
  it('dbNameForProject namespaces by project id', () => {
    expect(dbNameForProject('abc')).toBe('worldscript-localfirst-abc');
    expect(dbNameForProject('abc')).not.toBe(dbNameForProject('xyz'));
  });

  it('reports IndexedDB availability and an active provider in the test env', async () => {
    expect(isIndexedDbAvailable()).toBe(true);
    const doc = new Y.Doc();
    const persistence = persistProjectDoc('availability', doc);
    try {
      expect(persistence.active).toBe(true);
      await persistence.whenSynced; // resolves without throwing
      await persistence.clearData();
    } finally {
      await persistence.destroy();
    }
  });

  it('persists doc updates and reloads them into a fresh doc', async () => {
    const projectId = 'roundtrip';
    await clearPersisted(projectId); // isolation: start from a clean slate
    const docA = new Y.Doc();
    const pA = persistProjectDoc(projectId, docA);
    try {
      await pA.whenSynced;
      docA.getText('greeting').insert(0, 'hello world');

      // QNBS-v3 (CodeAnt): poll a fresh provider until the update has propagated to IndexedDB —
      // condition-driven, no wall-clock guess and no fixed-delay race. (Fake timers can't advance
      // fake-indexeddb's async IDBRequest resolution, so vi.waitFor is the deterministic mechanism.)
      await vi.waitFor(
        async () => {
          expect(await readPersisted(projectId)).toBe('hello world');
        },
        { timeout: 2000, interval: 50 },
      );
      // QNBS-v3 (CodeAnt): destroy the writer, then re-read — with pA gone the value can only come
      // from persisted IndexedDB (not live cross-provider sync), proving actual persistence.
      await pA.destroy();
      expect(await readPersisted(projectId)).toBe('hello world');
    } finally {
      await pA.destroy(); // idempotent (memoized)
      await clearPersisted(projectId); // wipe shared IDB via a fresh provider
    }
  });

  it('clearData wipes persisted state', async () => {
    const projectId = 'wipe';
    await clearPersisted(projectId); // isolation: start from a clean slate
    const docA = new Y.Doc();
    const pA = persistProjectDoc(projectId, docA);
    try {
      await pA.whenSynced;
      docA.getText('greeting').insert(0, 'temporary');
      await vi.waitFor(
        async () => {
          expect(await readPersisted(projectId)).toBe('temporary');
        },
        { timeout: 2000, interval: 50 },
      );
      await pA.clearData();
      // QNBS-v3 (CodeAnt): destroy the writer, then re-read — with pA gone the empty result can only
      // come from the cleared IndexedDB store (not live sync), proving clearData persisted the wipe.
      await pA.destroy();
      expect(await readPersisted(projectId)).toBe('');
    } finally {
      await pA.destroy(); // idempotent (memoized)
      await clearPersisted(projectId); // wipe shared IDB via a fresh provider
    }
  });
});
