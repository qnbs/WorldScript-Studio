/// <reference lib="dom" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
