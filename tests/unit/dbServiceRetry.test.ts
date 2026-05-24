import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Tests retryDb wrapper on saveProject/saveSettings by mocking saveSlice on the service
// instance — avoids needing a real or stubbed IDB environment.

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Minimal fake IDB objects so dbService can load and setDb without crashing.
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

describe('dbService – retryDb wraps saveProject / saveSettings', () => {
  let saveSliceMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    saveSliceMock = vi.fn();
  });

  async function getService() {
    const mod = await import('../../services/dbService');
    const svc = mod.dbService as unknown as Record<string, unknown>;
    svc['stateDb'] = fakeDb;
    svc['dataDb'] = fakeDb;
    svc['saveSlice'] = saveSliceMock;
    // Prevent auto-snapshot branch from running during tests
    svc['lastAutoSnapshotTime'] = Date.now();
    return mod.dbService;
  }

  describe('saveProject', () => {
    it('resolves on first attempt when saveSlice succeeds', async () => {
      saveSliceMock.mockResolvedValue(undefined);
      const svc = await getService();

      await expect(svc.saveProject({ title: 'Test' } as never)).resolves.toBeUndefined();
      expect(saveSliceMock).toHaveBeenCalledTimes(1);
    });

    it('retries on transient QuotaExceededError and succeeds on 2nd attempt', async () => {
      vi.useFakeTimers();
      let calls = 0;
      // QNBS-v3: sync throw avoids pre-created rejected promise causing unhandled-rejection warnings.
      saveSliceMock.mockImplementation(() => {
        if (++calls === 1) throw new DOMException('quota', 'QuotaExceededError');
        return Promise.resolve(undefined);
      });
      const svc = await getService();

      const promise = svc.saveProject({ title: 'Test' } as never);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
      expect(saveSliceMock).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('throws after all retries on repeated QuotaExceededError', async () => {
      vi.useFakeTimers();
      saveSliceMock.mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      const svc = await getService();

      const promise = svc.saveProject({ title: 'Test' } as never);
      // QNBS-v3: attach rejection handler before running timers to avoid transient unhandled-rejection.
      const assertion = expect(promise).rejects.toThrow('quota');
      await vi.runAllTimersAsync();
      // 1 initial + 2 retries = 3 total
      await assertion;
      expect(saveSliceMock).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('does not retry on a non-transient Error', async () => {
      saveSliceMock.mockImplementation(() => {
        throw new Error('unexpected');
      });
      const svc = await getService();

      await expect(svc.saveProject({ title: 'Test' } as never)).rejects.toThrow('unexpected');
      expect(saveSliceMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveSettings', () => {
    it('resolves on first attempt when saveSlice succeeds', async () => {
      saveSliceMock.mockResolvedValue(undefined);
      const svc = await getService();

      await expect(svc.saveSettings({} as never)).resolves.toBeUndefined();
      expect(saveSliceMock).toHaveBeenCalledTimes(1);
    });

    it('retries on transient AbortError and succeeds on 2nd attempt', async () => {
      vi.useFakeTimers();
      let calls = 0;
      saveSliceMock.mockImplementation(() => {
        if (++calls === 1) throw new DOMException('aborted', 'AbortError');
        return Promise.resolve(undefined);
      });
      const svc = await getService();

      const promise = svc.saveSettings({} as never);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
      expect(saveSliceMock).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('throws after all retries on repeated InvalidStateError', async () => {
      vi.useFakeTimers();
      saveSliceMock.mockImplementation(() => {
        throw new DOMException('invalid', 'InvalidStateError');
      });
      const svc = await getService();

      const promise = svc.saveSettings({} as never);
      // QNBS-v3: attach rejection handler before running timers to avoid transient unhandled-rejection.
      const assertion = expect(promise).rejects.toThrow('invalid');
      await vi.runAllTimersAsync();
      await assertion;
      expect(saveSliceMock).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    // QNBS-v3: Exponential backoff — delay increases between attempts (500ms → 1000ms → 2000ms).
    it('waits longer between successive retries (exponential backoff)', async () => {
      vi.useFakeTimers();
      let calls = 0;
      saveSliceMock.mockImplementation(() => {
        if (++calls < 3) throw new DOMException('quota', 'QuotaExceededError');
        return Promise.resolve(undefined);
      });
      const svc = await getService();

      const promise = svc.saveProject({ title: 'Test' } as never);
      // After first failure: at least 500ms base delay
      await vi.advanceTimersByTimeAsync(700);
      expect(saveSliceMock).toHaveBeenCalledTimes(2);
      // After second failure: at least 1000ms base delay
      await vi.advanceTimersByTimeAsync(1200);
      expect(saveSliceMock).toHaveBeenCalledTimes(3);
      await expect(promise).resolves.toBeUndefined();
      vi.useRealTimers();
    });
  });
});
