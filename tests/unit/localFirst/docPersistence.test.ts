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
async function readPersisted(projectId: string): Promise<string> {
  const doc = new Y.Doc();
  const persistence = persistProjectDoc(projectId, doc);
  await persistence.whenSynced;
  const value = doc.getText('greeting').toString();
  await persistence.destroy();
  return value;
}

describe('B1.1 — docPersistence (y-indexeddb)', () => {
  it('dbNameForProject namespaces by project id', () => {
    expect(dbNameForProject('abc')).toBe('storycraft-localfirst-abc');
    expect(dbNameForProject('abc')).not.toBe(dbNameForProject('xyz'));
  });

  it('reports IndexedDB availability and an active provider in the test env', async () => {
    expect(isIndexedDbAvailable()).toBe(true);
    const doc = new Y.Doc();
    const persistence = persistProjectDoc('availability', doc);
    expect(persistence.active).toBe(true);
    await persistence.whenSynced; // resolves without throwing
    await persistence.clearData();
    await persistence.destroy();
  });

  it('persists doc updates and reloads them into a fresh doc', async () => {
    const projectId = 'roundtrip';
    const docA = new Y.Doc();
    const pA = persistProjectDoc(projectId, docA);
    await pA.whenSynced;
    docA.getText('greeting').insert(0, 'hello world');

    // QNBS-v3 (CodeAnt): poll a fresh provider until the update has propagated to IndexedDB —
    // condition-driven, no wall-clock guess. (Fake timers can't advance fake-indexeddb's async
    // IDBRequest resolution, so vi.waitFor polling is the deterministic mechanism here.)
    await vi.waitFor(
      async () => {
        expect(await readPersisted(projectId)).toBe('hello world');
      },
      { timeout: 2000, interval: 50 },
    );
    await pA.destroy();
  });

  it('clearData wipes persisted state', async () => {
    const projectId = 'wipe';
    const docA = new Y.Doc();
    const pA = persistProjectDoc(projectId, docA);
    await pA.whenSynced;
    docA.getText('greeting').insert(0, 'temporary');
    await vi.waitFor(
      async () => {
        expect(await readPersisted(projectId)).toBe('temporary');
      },
      { timeout: 2000, interval: 50 },
    );
    await pA.clearData();
    await pA.destroy();

    expect(await readPersisted(projectId)).toBe('');
  });
});
