// @vitest-environment node
// QNBS-v3: node env mirrors the MCP server runtime — no indexedDB, so the memory bank uses its
// in-process fallback (exactly the path the Node adapter exercises in production).

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeProForgeCapability } from '../../../services/proForge/adapters/nodeProForgeCapability';
import { _resetDbForTest, getMemoryEntries } from '../../../services/proForge/proForgeMemoryBank';

const PAYLOAD = {
  projectId: 'p1',
  title: 'Demo',
  memoryEntries: [
    { category: 'lore', key: 'dragon', content: 'The dragon Vex guards the northern pass.' },
    { category: 'style', key: 'tone', content: 'Wry, fast-paced.' },
  ],
};

beforeEach(() => {
  // QNBS-v3: fresh fake-indexeddb per case (canonical IDB unit-test pattern). The deterministic seed
  // id makes seeding idempotent on both the idb (store.put) and in-process fallback paths.
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  _resetDbForTest();
});

afterEach(() => {
  _resetDbForTest();
});

describe('createNodeProForgeCapability — memory seeding (CodeAnt #5)', () => {
  it('seeds payload memory entries idempotently across rebuilds', async () => {
    // Three builds of the same payload simulate three back-to-back MCP tool calls. Before the fix
    // each build minted fresh random ids → 6 duplicate entries; now deterministic ids overwrite.
    await createNodeProForgeCapability(PAYLOAD, { env: {} });
    await createNodeProForgeCapability(PAYLOAD, { env: {} });
    await createNodeProForgeCapability(PAYLOAD, { env: {} });

    const entries = await getMemoryEntries('p1');
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.key).sort()).toEqual(['dragon', 'tone']);
  });

  it('honours an explicit entry id without duplicating on rebuild', async () => {
    const payload = {
      projectId: 'p2',
      memoryEntries: [{ id: 'fixed-1', category: 'lore', key: 'k', content: 'v' }],
    };
    await createNodeProForgeCapability(payload, { env: {} });
    await createNodeProForgeCapability(payload, { env: {} });

    const entries = await getMemoryEntries('p2');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('fixed-1');
  });
});
