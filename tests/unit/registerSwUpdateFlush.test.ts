// QNBS-v3 (DA-02): proves controllerchange flushes this tab's pending state before reloading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/logger')>();
  return { ...actual, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

const { mockFlushPersistedState } = vi.hoisted(() => ({ mockFlushPersistedState: vi.fn() }));
vi.mock('../../app/persistedStateFlush', () => ({ flushPersistedState: mockFlushPersistedState }));

import { appStoreRef } from '../../app/storeRef';
import { registerServiceWorker } from '../../register-sw';

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('register-sw — controllerchange flush-then-reload (DA-02)', () => {
  let controllerChangeHandler: (() => void) | undefined;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    controllerChangeHandler = undefined;

    for (const key of ['__TAURI_INTERNALS__', '__TAURI__', '__TAURI_METADATA__']) {
      delete (window as unknown as Record<string, unknown>)[key];
    }

    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
      configurable: true,
    });

    const fakeRegistration = {
      scope: '/',
      installing: null,
      waiting: null,
      addEventListener: vi.fn(),
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(fakeRegistration),
        controller: {},
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });

    appStoreRef.current = {
      getState: () => ({ fake: 'state' }) as never,
      dispatch: vi.fn() as never,
    };
  });

  afterEach(() => {
    appStoreRef.current = null;
    // @ts-expect-error — test-only cleanup of a property this suite defines itself.
    delete navigator.serviceWorker;
  });

  it('flushes pending state and reloads, in that order, when a new SW takes control', async () => {
    mockFlushPersistedState.mockResolvedValue(undefined);
    await registerServiceWorker();
    expect(controllerChangeHandler).toBeTypeOf('function');

    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const flushOrder = mockFlushPersistedState.mock.invocationCallOrder[0] as number;
    const reloadOrder = reloadSpy.mock.invocationCallOrder[0] as number;
    expect(flushOrder).toBeLessThan(reloadOrder);
  });

  it('defers the reload when the flush fails, instead of discarding unflushed edits', async () => {
    mockFlushPersistedState.mockRejectedValue(new Error('IDB write failed'));
    await registerServiceWorker();

    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('ignores a second controllerchange event (single-flight)', async () => {
    mockFlushPersistedState.mockResolvedValue(undefined);
    await registerServiceWorker();

    controllerChangeHandler?.();
    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('still reloads when no store is mounted yet (defensive null-guard, nothing to flush)', async () => {
    appStoreRef.current = null;
    await registerServiceWorker();

    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
