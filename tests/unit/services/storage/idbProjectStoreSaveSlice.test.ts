/**
 * Tests for IdbProjectStore#saveSlice — DA-02 review-wave fix (codex): the returned promise must
 * resolve only once the underlying IndexedDB transaction actually commits (transaction.oncomplete),
 * not merely once the individual put() request succeeds (request.onsuccess) — a caller that reloads
 * immediately after resolution must never be able to tear down the page mid-commit.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  resolveProtectedWriteKey: vi.fn().mockResolvedValue(null),
  assertNoActiveEncryptionMigration: vi.fn().mockResolvedValue(undefined),
  idbEncryptWithKey: vi.fn(),
  idbReadSecure: vi.fn(),
  assertIdbProtectedWriteAllowed: vi.fn().mockResolvedValue(undefined),
  assertSecureStorageReadable: vi.fn().mockResolvedValue(undefined),
}));

import { IdbProjectStore } from '../../../../services/storage/idbProjectStore';

interface FakeIdbRequest {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  error: unknown;
}

interface FakeIdbTransaction {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: unknown;
}

function makeFakeStore(): { store: { put: () => FakeIdbRequest; transaction: FakeIdbTransaction }; request: FakeIdbRequest; transaction: FakeIdbTransaction } {
  const transaction: FakeIdbTransaction = { oncomplete: null, onerror: null, onabort: null, error: null };
  const request: FakeIdbRequest = { onsuccess: null, onerror: null, error: null };
  const store = { put: () => request, transaction };
  return { store, request, transaction };
}

describe('IdbProjectStore#saveSlice — resolves on transaction commit, not request success', () => {
  it('does not resolve when only request.onsuccess has fired', async () => {
    const projectStore = new IdbProjectStore();
    const { store, request, transaction } = makeFakeStore();
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    let resolved = false;
    const savePromise = projectStore.saveSlice('settings', { theme: 'dark' } as never).then(() => {
      resolved = true;
    });

    // Give the async setup (key resolution, migration guard, getObjectStore) time to run and call put().
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.onsuccess?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolved).toBe(false);
    transaction.oncomplete?.(); // settle the promise so it doesn't leak past this test
    await savePromise;
  });

  it('resolves once transaction.oncomplete fires, after request.onsuccess', async () => {
    const projectStore = new IdbProjectStore();
    const { store, request, transaction } = makeFakeStore();
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const order: string[] = [];
    const savePromise = projectStore
      .saveSlice('settings', { theme: 'dark' } as never)
      .then(() => order.push('resolved'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    request.onsuccess?.();
    order.push('request-succeeded');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['request-succeeded']);

    transaction.oncomplete?.();
    await savePromise;
    expect(order).toEqual(['request-succeeded', 'resolved']);
  });

  it('rejects if the transaction aborts even though the request itself succeeded', async () => {
    const projectStore = new IdbProjectStore();
    const { store, request, transaction } = makeFakeStore();
    vi.spyOn(
      projectStore as unknown as { getObjectStore: () => Promise<unknown> },
      'getObjectStore',
    ).mockResolvedValue(store as never);

    const savePromise = projectStore.saveSlice('settings', { theme: 'dark' } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.onsuccess?.();
    transaction.error = new Error('QuotaExceededError');
    transaction.onabort?.();

    await expect(savePromise).rejects.toThrow('QuotaExceededError');
  });
});
