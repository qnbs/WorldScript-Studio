// @vitest-environment node
/**
 * Tests for services/loraAdapterService.ts
 * QNBS-v3: Uses global.indexedDB = new IDBFactory() per test (node env, sceneRevisionService pattern).
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Reset IDB per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

// ---------------------------------------------------------------------------
// Import after global setup
// ---------------------------------------------------------------------------

import {
  deleteAdapter,
  getAdapterBlob,
  type LoraAdapterMeta,
  listAdapters,
  saveAdapter,
} from '../../services/loraAdapterService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const META: LoraAdapterMeta = {
  id: 'lora-1',
  name: 'Fantasy Style',
  description: 'Fantasy prose adapter',
  modelCompatibility: 'Phi-3.5-mini',
  scale: 0.8,
  fileSizeBytes: 512,
  createdAt: 1716000000000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listAdapters', () => {
  it('returns empty array when no adapters saved', async () => {
    const result = await listAdapters();
    expect(result).toEqual([]);
  });

  it('returns saved adapters', async () => {
    const blob = new ArrayBuffer(4);
    await saveAdapter(META, blob);
    const result = await listAdapters();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('lora-1');
    expect(result[0]!.name).toBe('Fantasy Style');
  });
});

describe('saveAdapter', () => {
  it('persists meta fields correctly', async () => {
    await saveAdapter(META, new ArrayBuffer(4));
    const adapters = await listAdapters();
    expect(adapters[0]!.scale).toBe(0.8);
    expect(adapters[0]!.modelCompatibility).toBe('Phi-3.5-mini');
  });

  it('overwrites existing adapter with same id', async () => {
    const blob = new ArrayBuffer(4);
    await saveAdapter(META, blob);
    await saveAdapter({ ...META, name: 'Updated' }, blob);
    const adapters = await listAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0].name).toBe('Updated');
  });
});

describe('deleteAdapter', () => {
  it('removes adapter from list', async () => {
    await saveAdapter(META, new ArrayBuffer(4));
    await deleteAdapter('lora-1');
    const result = await listAdapters();
    expect(result).toHaveLength(0);
  });

  it('does not throw when deleting non-existent id', async () => {
    await expect(deleteAdapter('nonexistent')).resolves.toBeUndefined();
  });
});

describe('getAdapterBlob', () => {
  it('returns null when adapter not found', async () => {
    const blob = await getAdapterBlob('missing');
    expect(blob).toBeNull();
  });

  it('returns the stored ArrayBuffer after save', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    await saveAdapter(META, buffer);
    const result = await getAdapterBlob('lora-1');
    expect(result).not.toBeNull();
    expect(result?.byteLength).toBe(4);
  });
});
