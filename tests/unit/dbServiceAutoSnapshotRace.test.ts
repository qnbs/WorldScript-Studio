// QNBS-v3: proves a saveProject() call arriving before the first snapshot's success callback runs never starts a duplicate concurrent auto-snapshot.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/logger', () => {
  const noopLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return {
    logger: noopLogger,
    createLogger: () => ({ ...noopLogger, withContext: () => ({ ...noopLogger }) }),
  };
});

const fakeStore = {
  put: vi.fn().mockImplementation(() => {
    const r: Record<string, unknown> = {};
    Promise.resolve().then(() => {
      if (typeof r['onsuccess'] === 'function') (r['onsuccess'] as () => void)();
    });
    return r;
  }),
  count: vi.fn().mockImplementation(() => {
    const r = { result: 0 } as Record<string, unknown>;
    Promise.resolve().then(() => {
      if (typeof r['onsuccess'] === 'function') (r['onsuccess'] as () => void)();
    });
    return r;
  }),
};

const fakeDb = {
  objectStoreNames: { contains: () => true },
  transaction: vi.fn().mockReturnValue({ objectStore: () => fakeStore }),
};

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('dbService — saveProject auto-snapshot in-flight guard (DA-02, codex)', () => {
  let saveSliceMock: ReturnType<typeof vi.fn>;
  let createSnapshotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    saveSliceMock = vi.fn().mockResolvedValue(undefined);
    createSnapshotMock = vi.fn();
  });

  async function getService() {
    const mod = await import('../../services/dbService');
    const svc = mod.dbService as unknown as Record<string, unknown>;
    svc['stateDb'] = fakeDb;
    svc['dataDb'] = fakeDb;
    svc['saveSlice'] = saveSliceMock;
    svc['createSnapshot'] = createSnapshotMock;
    // Force the 5-minute interval to already have elapsed.
    svc['lastAutoSnapshotTime'] = 0;
    return mod.dbService;
  }

  const project = { title: 'T', manuscript: [{ id: '1', title: 'S', content: 'x' }] };

  it('does not start a second concurrent auto-snapshot while the first is still pending', async () => {
    let resolveFirstSnapshot: (id: number) => void = () => {};
    createSnapshotMock.mockImplementationOnce(
      () => new Promise<number>((resolve) => { resolveFirstSnapshot = resolve; }),
    );

    const svc = await getService();
    const firstSave = svc.saveProject({ present: { data: project } } as never);
    const secondSave = svc.saveProject({ present: { data: project } } as never);

    await Promise.all([firstSave, secondSave]);
    await flushMicrotasks();
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);

    resolveFirstSnapshot(1);
    await flushMicrotasks();
  });

  it('allows a new auto-snapshot once the prior one has settled and the interval has elapsed again', async () => {
    createSnapshotMock.mockResolvedValueOnce(1);
    const svc = await getService();

    await svc.saveProject({ present: { data: project } } as never);
    await flushMicrotasks();
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);

    (svc as unknown as Record<string, unknown>)['lastAutoSnapshotTime'] = 0;
    createSnapshotMock.mockResolvedValueOnce(2);
    await svc.saveProject({ present: { data: project } } as never);
    await flushMicrotasks();
    expect(createSnapshotMock).toHaveBeenCalledTimes(2);
  });
});
