import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const { mockClearData } = vi.hoisted(() => ({
  mockClearData: vi.fn(),
}));

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();
    destroy = vi.fn().mockResolvedValue(undefined);
    clearData() {
      return mockClearData();
    }
  },
}));

import { persistProjectDoc } from '../../../services/localFirst/docPersistence';

describe('docPersistence clearData error propagation', () => {
  beforeEach(() => {
    mockClearData.mockReset();
    mockClearData.mockResolvedValue(undefined);
  });

  it('propagates a provider wipe failure to the caller', async () => {
    const failure = new Error('provider wipe failed');
    mockClearData.mockRejectedValue(failure);
    const persistence = persistProjectDoc('clear-failure', new Y.Doc());

    try {
      await expect(persistence.clearData()).rejects.toBe(failure);
    } finally {
      await persistence.destroy();
    }
  });
});
