// QNBS-v3 (DA-02): proves controllerchange flushes the latest visible-tab state before reloading.
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

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

describe('register-sw — controllerchange flush-then-reload (DA-02)', () => {
  let controllerChangeHandler: (() => void) | undefined;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    controllerChangeHandler = undefined;
    setVisibility('visible');

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

    // QNBS-v3: a stable reference — a fresh object each call would never satisfy the "unchanged" stop condition.
    const stableState = { fake: 'state' };
    appStoreRef.current = {
      getState: () => stableState as never,
      dispatch: vi.fn() as never,
    };
  });

  afterEach(() => {
    appStoreRef.current = null;
    // @ts-expect-error — test-only cleanup of a property this suite defines itself.
    delete navigator.serviceWorker;
    setVisibility('visible');
  });

  it('flushes pending state and reloads, in that order, when the visible tab takes control', async () => {
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

  it('reloads even when the flush fails, rather than staying on a bundle whose old cache is already pruned', async () => {
    mockFlushPersistedState.mockRejectedValue(new Error('IDB write failed'));
    await registerServiceWorker();

    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
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

  // QNBS-v3 (codex P1): a hidden tab's state can't be fresher than what's already persisted — only the visible tab flushes.
  it('defers reload while the tab is hidden, then reloads once visible without flushing again', async () => {
    mockFlushPersistedState.mockResolvedValue(undefined);
    await registerServiceWorker();
    setVisibility('hidden');

    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flushMicrotasks();

    // QNBS-v3 (codex): index.tsx's own visibilitychange listener already flushed this tab when it went hidden — flushing its possibly-stale copy again here could clobber a fresher write from another tab.
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3 (CodeAnt/codex): a single snapshot could miss an edit made while the async write is still in flight.
  it('re-flushes with the latest state when it changes during the pending flush, before reloading', async () => {
    const stateA = { v: 'a' };
    const stateB = { v: 'b' };
    // 1st getState(): stateA. 2nd (after flush #1): stateB (changed — retry). 3rd (after flush #2): stateB (stable — stop).
    const getStateMock = vi.fn().mockReturnValueOnce(stateA).mockReturnValueOnce(stateB).mockReturnValue(stateB);
    appStoreRef.current = { getState: getStateMock, dispatch: vi.fn() as never };
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    controllerChangeHandler?.();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(2);
    expect(mockFlushPersistedState).toHaveBeenNthCalledWith(1, stateA);
    expect(mockFlushPersistedState).toHaveBeenNthCalledWith(2, stateB);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const lastFlushOrder = mockFlushPersistedState.mock.invocationCallOrder[1] as number;
    const reloadOrder = reloadSpy.mock.invocationCallOrder[0] as number;
    expect(lastFlushOrder).toBeLessThan(reloadOrder);
  });

  // QNBS-v3 (codex P2): the retry loop can exhaust its budget while state keeps changing — one guaranteed final flush must still capture whatever's freshest, not silently drop it.
  it('performs one final guaranteed flush of the freshest state after exhausting the retry budget', async () => {
    const states = Array.from({ length: 7 }, (_, i) => ({ v: i }));
    const getStateMock = vi.fn();
    for (const s of states) getStateMock.mockReturnValueOnce(s);
    appStoreRef.current = { getState: getStateMock, dispatch: vi.fn() as never };
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    controllerChangeHandler?.();
    await flushMicrotasks();

    // 5 in-loop attempts (states[0..4]) + 1 guaranteed final flush of the freshest state (states[6]).
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(6);
    expect(mockFlushPersistedState).toHaveBeenNthCalledWith(6, states[6]);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
