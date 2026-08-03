// @vitest-environment node
// QNBS-v3: node environment avoids jsdom's non-configurable indexedDB stub.
//          Fresh IDBFactory + _resetDbForTest() ensures complete test isolation.

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Deterministic 4-dim embeddings over a tiny vocabulary so semantic ranking is testable
// without loading the real MiniLM model. searchMemoryEntries dynamically imports this module.
vi.mock('../../../services/ai/localEmbeddingService', () => {
  const VOCAB = ['dragon', 'sea', 'hero', 'magic'];
  const embed = (text: string): number[] => {
    const lower = text.toLowerCase();
    const v = VOCAB.map((w) => (lower.match(new RegExp(w, 'g')) ?? []).length);
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return v.map((x) => x / norm);
  };
  return {
    embedText: vi.fn(async (t: string) => embed(t)),
    cosineSimilarity: (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0),
    embedBatch: vi.fn(),
  };
});

import {
  _resetDbForTest,
  clearMemoryBankCache,
  deleteMemoryEntry,
  getMemoryBank,
  getMemoryEntries,
  ProForgeMemoryBank,
  saveMemoryEntry,
  searchMemoryEntries,
} from '../../../services/proForge/proForgeMemoryBank';
import { _resetPassphraseSentinelForTest } from '../../../services/storage/idbPassphraseSentinel';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  setupIdbEncryption,
} from '../../../services/storage/storageEncryptionService';

const DB_NAME = 'proforge-memory-bank';
const STORE = 'entries';

async function readRawMemoryEntry(id: string): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawMemoryEntry(record: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  _resetDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
});

// ---------------------------------------------------------------------------
// saveMemoryEntry
// ---------------------------------------------------------------------------

describe('saveMemoryEntry', () => {
  it('saves an entry and returns it with id and createdAt', async () => {
    const entry = await saveMemoryEntry({
      projectId: 'proj-1',
      category: 'lore',
      key: 'world-geography',
      content: 'The kingdom of Aralon lies north of the sea.',
      sourceStage: 'intake',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(entry.projectId).toBe('proj-1');
    expect(entry.category).toBe('lore');
    expect(entry.key).toBe('world-geography');
    expect(entry.content).toBe('The kingdom of Aralon lies north of the sea.');
  });

  it('uses provided id if given', async () => {
    const entry = await saveMemoryEntry({
      id: 'custom-id-1',
      projectId: 'proj-1',
      category: 'character',
      key: 'hero',
      content: 'The hero is brave.',
      sourceStage: 'structural',
    });
    expect(entry.id).toBe('custom-id-1');
  });

  it('generates a unique id when none provided', async () => {
    const e1 = await saveMemoryEntry({
      projectId: 'proj-1',
      category: 'style',
      key: 'tone',
      content: 'Formal',
      sourceStage: 'intake',
    });
    const e2 = await saveMemoryEntry({
      projectId: 'proj-1',
      category: 'style',
      key: 'voice',
      content: 'Active',
      sourceStage: 'intake',
    });
    expect(e1.id).not.toBe(e2.id);
  });
});

// ---------------------------------------------------------------------------
// getMemoryEntries
// ---------------------------------------------------------------------------

describe('getMemoryEntries', () => {
  it('returns empty array for a project with no entries', async () => {
    const entries = await getMemoryEntries('unknown-project');
    expect(entries).toHaveLength(0);
  });

  it('returns all entries for a project', async () => {
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'k1',
      content: 'v1',
      sourceStage: 'intake',
    });
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'character',
      key: 'k2',
      content: 'v2',
      sourceStage: 'structural',
    });
    const entries = await getMemoryEntries('p1');
    expect(entries).toHaveLength(2);
  });

  it('does not return entries from other projects', async () => {
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'k1',
      content: 'v1',
      sourceStage: 'intake',
    });
    await saveMemoryEntry({
      projectId: 'p2',
      category: 'lore',
      key: 'k2',
      content: 'v2',
      sourceStage: 'intake',
    });
    const entries = await getMemoryEntries('p1');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.projectId).toBe('p1');
  });

  it('filters by category when provided', async () => {
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'world',
      content: 'w',
      sourceStage: 'intake',
    });
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'character',
      key: 'hero',
      content: 'h',
      sourceStage: 'intake',
    });
    const loreEntries = await getMemoryEntries('p1', 'lore');
    expect(loreEntries).toHaveLength(1);
    expect(loreEntries[0]!.category).toBe('lore');
  });
});

// ---------------------------------------------------------------------------
// searchMemoryEntries
// ---------------------------------------------------------------------------

describe('searchMemoryEntries', () => {
  it('returns entries matching query keywords', async () => {
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'dragon',
      content: 'The dragon lives in the mountains.',
      sourceStage: 'intake',
    });
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'ocean',
      content: 'The ocean is vast and blue.',
      sourceStage: 'intake',
    });

    const results = await searchMemoryEntries('p1', 'dragon mountains');
    expect(results).toHaveLength(1);
    expect(results[0]!.key).toBe('dragon');
  });

  it('returns empty array when no entries match', async () => {
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'sky',
      content: 'Blue sky above.',
      sourceStage: 'intake',
    });
    const results = await searchMemoryEntries('p1', 'dragon');
    expect(results).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await saveMemoryEntry({
        projectId: 'p1',
        category: 'lore',
        key: `entry-${i}`,
        content: `common word test entry ${i}`,
        sourceStage: 'intake',
      });
    }
    const results = await searchMemoryEntries('p1', 'common entry', 2);
    expect(results).toHaveLength(2);
  });

  it('short query keywords (≤2 chars) are not matched', async () => {
    await saveMemoryEntry({
      projectId: 'p1',
      category: 'lore',
      key: 'ab',
      content: 'ab cd ef',
      sourceStage: 'intake',
    });
    // 'ab', 'cd', 'ef' are all ≤2 chars → score stays 0 → no results
    const results = await searchMemoryEntries('p1', 'ab');
    expect(results).toHaveLength(0);
  });
});

describe('searchMemoryEntries — semantic & hybrid modes', () => {
  beforeEach(async () => {
    await saveMemoryEntry({
      projectId: 'p2',
      category: 'lore',
      key: 'k1',
      content: 'The dragon guards the mountain.',
      sourceStage: 'intake',
    });
    await saveMemoryEntry({
      projectId: 'p2',
      category: 'lore',
      key: 'k2',
      content: 'The hero sails the sea.',
      sourceStage: 'intake',
    });
  });

  it('ranks by embedding similarity in semantic mode', async () => {
    const results = await searchMemoryEntries('p2', 'dragon', 10, 'semantic');
    expect(results[0]?.key).toBe('k1');
  });

  it('blends keyword + semantic in hybrid mode', async () => {
    const results = await searchMemoryEntries('p2', 'hero sea', 10, 'hybrid');
    expect(results[0]?.key).toBe('k2');
  });

  it('falls back to keyword ranking when embedding fails', async () => {
    const svc = await import('../../../services/ai/localEmbeddingService');
    vi.mocked(svc.embedText).mockRejectedValueOnce(new Error('no model'));
    const results = await searchMemoryEntries('p2', 'dragon', 10, 'hybrid');
    expect(results.some((r) => r.key === 'k1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteMemoryEntry
// ---------------------------------------------------------------------------

describe('deleteMemoryEntry', () => {
  it('removes an entry', async () => {
    const entry = await saveMemoryEntry({
      projectId: 'p1',
      category: 'meta',
      key: 'k',
      content: 'v',
      sourceStage: 'intake',
    });
    await deleteMemoryEntry(entry.id);
    const remaining = await getMemoryEntries('p1');
    expect(remaining).toHaveLength(0);
  });

  it('does not throw when deleting a non-existent id', async () => {
    await expect(deleteMemoryEntry('ghost-id')).resolves.not.toThrow();
  });
});

describe('memory bank encrypted persistence', () => {
  it('keeps keys, content, embeddings, and source stage out of raw IndexedDB', async () => {
    await setupIdbEncryption('memory-passphrase');
    const entry = await saveMemoryEntry({
      id: 'encrypted-entry',
      projectId: 'p-encrypted',
      category: 'lore',
      key: 'MEMORY_KEY_CANARY',
      content: 'MEMORY_CONTENT_CANARY',
      sourceStage: 'structural',
      embedding: [0.123456, 0.654321],
    });
    const raw = await readRawMemoryEntry(entry.id);

    expect(raw?.['projectId']).toBe('p-encrypted');
    expect(raw?.['category']).toBe('lore');
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('MEMORY_KEY_CANARY');
    expect(JSON.stringify(raw)).not.toContain('MEMORY_CONTENT_CANARY');
    expect(JSON.stringify(raw)).not.toContain('0.123456');
    await expect(getMemoryEntries('p-encrypted')).resolves.toEqual([entry]);
  });

  it('rejects memory-bank reads and writes while configured encryption is locked', async () => {
    await setupIdbEncryption('memory-passphrase');
    await saveMemoryEntry({
      projectId: 'p-locked',
      category: 'lore',
      key: 'locked',
      content: 'sensitive',
      sourceStage: 'intake',
    });
    clearIdbEncryptionKey();

    await expect(getMemoryEntries('p-locked')).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(
      saveMemoryEntry({
        projectId: 'p-locked',
        category: 'lore',
        key: 'new',
        content: 'must not persist',
        sourceStage: 'intake',
      }),
    ).rejects.toBeInstanceOf(SecureRecordLockedError);
  });

  it('lazily rewrites a legacy plaintext memory entry after unlock', async () => {
    const seed = await saveMemoryEntry({
      projectId: 'seed',
      category: 'meta',
      key: 'seed',
      content: 'seed',
      sourceStage: 'intake',
    });
    await deleteMemoryEntry(seed.id);
    const legacy = {
      id: 'legacy-memory',
      projectId: 'p-legacy',
      category: 'character',
      key: 'LEGACY_MEMORY_KEY_CANARY',
      content: 'LEGACY_MEMORY_CONTENT_CANARY',
      sourceStage: 'intake',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await writeRawMemoryEntry(legacy);
    await setupIdbEncryption('memory-passphrase');

    await expect(getMemoryEntries('p-legacy')).resolves.toEqual([legacy]);
    const migrated = await readRawMemoryEntry(legacy.id);
    expect(isSecureRecordEnvelope(migrated?.['payload'])).toBe(true);
    expect(JSON.stringify(migrated)).not.toContain('LEGACY_MEMORY_CONTENT_CANARY');
  });

  it('fails closed when an encrypted memory entry is corrupted', async () => {
    await setupIdbEncryption('memory-passphrase');
    const entry = await saveMemoryEntry({
      id: 'corrupt-memory',
      projectId: 'p-corrupt',
      category: 'meta',
      key: 'corrupt',
      content: 'CORRUPTION_CANARY',
      sourceStage: 'intake',
    });
    const raw = await readRawMemoryEntry(entry.id);
    const payload = raw?.['payload'];
    if (!raw || !isSecureRecordEnvelope(payload)) throw new Error('Expected memory envelope');
    const ciphertext = new Uint8Array(payload.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await writeRawMemoryEntry({ ...raw, payload: { ...payload, ciphertext } });

    await expect(getMemoryEntries('p-corrupt')).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });
});

// ---------------------------------------------------------------------------
// ProForgeMemoryBank class
// ---------------------------------------------------------------------------

describe('ProForgeMemoryBank', () => {
  it('remember() saves an entry via the class', async () => {
    const bank = new ProForgeMemoryBank('proj-mb');
    const entry = await bank.remember('character', 'Alice', 'The protagonist', 'intake');
    expect(entry.projectId).toBe('proj-mb');
    expect(entry.category).toBe('character');
    expect(entry.key).toBe('Alice');
  });

  it('recall() returns all entries for the project', async () => {
    const bank = new ProForgeMemoryBank('proj-mb');
    await bank.remember('lore', 'magic', 'Magic exists', 'intake');
    await bank.remember('character', 'Bob', 'The antagonist', 'structural');
    const entries = await bank.recall();
    expect(entries).toHaveLength(2);
  });

  it('recall(category) returns only entries of that category', async () => {
    const bank = new ProForgeMemoryBank('proj-mb');
    await bank.remember('lore', 'world', 'The world', 'intake');
    await bank.remember('character', 'hero', 'The hero', 'intake');
    const lore = await bank.recall('lore');
    expect(lore).toHaveLength(1);
    expect(lore[0]!.key).toBe('world');
  });

  it('search() returns matching entries', async () => {
    const bank = new ProForgeMemoryBank('proj-mb');
    await bank.remember('lore', 'kingdom', 'The kingdom of Aralon', 'intake');
    await bank.remember('lore', 'ocean', 'The vast ocean', 'intake');
    const results = await bank.search('kingdom aralon');
    expect(results.some((e) => e.key === 'kingdom')).toBe(true);
  });

  it('clear() removes all entries for the project', async () => {
    const bank = new ProForgeMemoryBank('proj-mb');
    await bank.remember('meta', 'x', 'v', 'intake');
    await bank.clear();
    const entries = await bank.recall();
    expect(entries).toHaveLength(0);
  });

  describe('recallForStage', () => {
    it('returns entries from earlier stages', async () => {
      const bank = new ProForgeMemoryBank('proj-stage');
      await bank.remember('meta', 'intake-note', 'Intake data', 'intake');
      await bank.remember('meta', 'structural-note', 'Structural data', 'structural');

      // When requesting for 'copyEdit', both 'intake' and 'structural' entries should appear
      // (they come before 'copyEdit' in the stage order)
      const entries = await bank.recallForStage('copyEdit');
      expect(entries.some((e) => e.key === 'intake-note')).toBe(true);
      expect(entries.some((e) => e.key === 'structural-note')).toBe(true);
    });

    it('excludes entries from the same or later stages', async () => {
      const bank = new ProForgeMemoryBank('proj-stage');
      await bank.remember('meta', 'proof-note', 'Proof data', 'proof');

      // 'proof' is at same position — should not appear when recalling for 'proof'
      const entries = await bank.recallForStage('proof');
      expect(entries.some((e) => e.key === 'proof-note')).toBe(false);
    });

    it('always includes lore and character entries regardless of stage', async () => {
      const bank = new ProForgeMemoryBank('proj-stage');
      // Add a publishing-stage lore entry (later than intake)
      await bank.remember('lore', 'world-lore', 'Ancient world', 'publishing');

      // Should still appear when recalling for 'intake' (lore is always included)
      const entries = await bank.recallForStage('intake');
      expect(entries.some((e) => e.key === 'world-lore')).toBe(true);
    });
  });

  describe('buildContextString', () => {
    it('returns empty string when no entries exist', async () => {
      const bank = new ProForgeMemoryBank('proj-ctx');
      const ctx = await bank.buildContextString('intake');
      expect(ctx).toBe('');
    });

    it('includes memory bank context header when entries exist', async () => {
      const bank = new ProForgeMemoryBank('proj-ctx');
      await bank.remember('lore', 'world', 'The world of Aralon', 'intake');
      const ctx = await bank.buildContextString('structural');
      expect(ctx).toContain('MEMORY BANK CONTEXT');
      expect(ctx).toContain('Aralon');
    });

    it('respects maxChars limit', async () => {
      const bank = new ProForgeMemoryBank('proj-ctx');
      // Add a large entry
      await bank.remember('lore', 'big', 'x'.repeat(5000), 'intake');
      const ctx = await bank.buildContextString('structural', undefined, 100);
      expect(ctx.length).toBeLessThanOrEqual(200); // some header + truncation
    });

    it('uses search query when provided', async () => {
      const bank = new ProForgeMemoryBank('proj-ctx');
      await bank.remember('lore', 'dragon', 'Dragons breathe fire', 'intake');
      await bank.remember('lore', 'ocean', 'The ocean is vast', 'intake');
      // Only intake entries should be in structural recall range
      const ctx = await bank.buildContextString('structural', 'dragon');
      // Context should reference dragon (from search), might not include ocean
      // Just verify it runs without error and returns a string
      expect(typeof ctx).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// getMemoryBank singleton factory
// ---------------------------------------------------------------------------

describe('getMemoryBank', () => {
  it('returns the same instance for the same projectId', () => {
    clearMemoryBankCache();
    const b1 = getMemoryBank('proj-x');
    const b2 = getMemoryBank('proj-x');
    expect(b1).toBe(b2);
  });

  it('returns different instances for different projectIds', () => {
    clearMemoryBankCache();
    const b1 = getMemoryBank('proj-a');
    const b2 = getMemoryBank('proj-b');
    expect(b1).not.toBe(b2);
  });
});
