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

  // QNBS-v3: prove teardown cannot make a deferred wipe appear successful / keep the encryption transition from mistaking an already-detached provider for cleared data.
  it('rejects a deferred wipe when provider teardown begins first', async () => {
    const persistence = persistProjectDoc('clear-after-destroy', new Y.Doc());
    const clearPromise = persistence.clearData();
    const destroyPromise = persistence.destroy();

    await expect(clearPromise).rejects.toThrow('destruction has started');
    await destroyPromise;
  });

  // QNBS-v3: [Grund: regression for wipe failure propagation / Impact: prevents false cleanup success / Kreativer Mehrwert: keeps encryption transitions fail-closed]
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
