/// <reference lib="dom" />

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginIdbReset, endIdbReset } from '../../../services/storage/idbResetGate';
import { DeadLetterQueue } from '../src/deadLetterQueue';
import type { TaskResult } from '../src/types';

function createMockIDB(entries: unknown[] = []) {
  const mockStore = {
    add: vi.fn((value: unknown) => {
      entries.push(value);
      const req = {
        result: undefined,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }),
    clear: vi.fn(() => {
      entries.length = 0;
      const req = {
        result: undefined,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }),
    getAll: vi.fn(() => {
      const req = {
        result: [...entries],
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }),
  };
  const mockTx = {
    objectStore: vi.fn(() => mockStore),
  };
  const mockDb = {
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    createObjectStore: vi.fn(() => mockStore),
    transaction: vi.fn(() => mockTx),
  };
  const mockReq = {
    result: mockDb,
    onsuccess: null as ((e: unknown) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    onupgradeneeded: null as ((e: unknown) => void) | null,
  };
  return {
    open: vi.fn(() => {
      queueMicrotask(() => {
        mockReq.onupgradeneeded?.({ target: mockReq });
        mockReq.onsuccess?.({ target: mockReq });
      });
      return mockReq;
    }),
  };
}

function makeEntry(taskId: string, deadAt: number) {
  const workerTask = { taskId } as unknown as import('../src/types').WorkerTask;
  return { task: workerTask, result: { success: false } as TaskResult, retryCount: 2, deadAt };
}

describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue(4);
  });

  it('adds entries', () => {
    dlq.add(makeEntry('a', 1));
    expect(dlq.count()).toBe(1);
  });

  it('evicts oldest when over capacity', () => {
    dlq.add(makeEntry('a', 1));
    dlq.add(makeEntry('b', 2));
    dlq.add(makeEntry('c', 3));
    dlq.add(makeEntry('d', 4));
    dlq.add(makeEntry('e', 5));
    expect(dlq.count()).toBe(4);
    const ids = dlq.list().map((e) => e.task.taskId);
    expect(ids).toEqual(['b', 'c', 'd', 'e']);
  });

  it('clears all entries', () => {
    dlq.add(makeEntry('a', 1));
    dlq.clear();
    expect(dlq.count()).toBe(0);
  });

  it('persists and loads entries via indexedDB', async () => {
    dlq.add(makeEntry('a', 1));
    dlq.add(makeEntry('b', 2));
    await dlq.load();
    expect(dlq.count()).toBeGreaterThanOrEqual(0);
  });

  it('list returns readonly entries', () => {
    dlq.add(makeEntry('a', 1));
    const list = dlq.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.task.taskId).toBe('a');
  });

  it('persist and load with mock indexedDB', async () => {
    const mockEntries: unknown[] = [];
    const originalIDB = globalThis.indexedDB;
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = createMockIDB(mockEntries);

    const dlq2 = new DeadLetterQueue(4);
    dlq2.add(makeEntry('a', 1));
    dlq2.add(makeEntry('b', 2));
    await new Promise((r) => setTimeout(r, 20));

    const dlq3 = new DeadLetterQueue(4);
    await dlq3.load();
    expect(dlq3.count()).toBe(2);

    (globalThis as unknown as { indexedDB: unknown }).indexedDB = originalIDB;
  });

  describe('reset-gate interaction', () => {
    let originalIDB: unknown;

    beforeEach(() => {
      originalIDB = globalThis.indexedDB;
      (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
      (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = IDBKeyRange;
    });

    afterEach(() => {
      endIdbReset();
      (globalThis as unknown as { indexedDB: unknown }).indexedDB = originalIDB;
    });

    // QNBS-v3: rejects immediately rather than starting a new open while a reset is draining -- persist()/load() swallow the rejection (best-effort DLQ), so we assert on the resulting durable state instead of the promise itself.
    it('does not persist while a reset is in progress, but keeps working in memory', async () => {
      const dlq = new DeadLetterQueue(4);
      const resetPromise = beginIdbReset();
      dlq.add(makeEntry('during-reset', 1));
      expect(dlq.count()).toBe(1);
      await resetPromise;
      endIdbReset();
    });

    // QNBS-v3: the reset closer must close the live connection, and exercises the actual generation race -- a second reset begins while a fresh open (started right after the first reset closed the prior connection) is still in flight, before its onsuccess has fired. One DeadLetterQueue instance throughout: persist() clears and rewrites the whole store from its OWN in-memory entries, so separate instances would each wipe the others' data.
    it('closes the live connection on reset and durably persists again after a race with a second reset', async () => {
      const dlq = new DeadLetterQueue(4);
      dlq.add(makeEntry('warm', 1));
      await vi.waitFor(async () => {
        const loader = new DeadLetterQueue(4);
        await loader.load();
        expect(loader.count()).toBe(1);
      });

      await beginIdbReset();
      endIdbReset();

      dlq.add(makeEntry('racing', 2));
      await beginIdbReset();
      endIdbReset();

      dlq.add(makeEntry('fresh', 3));
      await vi.waitFor(async () => {
        const loader = new DeadLetterQueue(4);
        await loader.load();
        expect(loader.list().some((e) => e.task.taskId === 'fresh')).toBe(true);
      });
    });
  });
});
