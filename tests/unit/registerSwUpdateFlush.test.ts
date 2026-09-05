// QNBS-v3: proves controllerchange flushes the latest visible-tab state before reloading.
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

// QNBS-v3: ServiceWorker.scriptURL is always a fully resolved absolute URL per spec — a relative-path mock here would silently hide the exact absolute-vs-relative bug this regression suite exists to catch. import.meta.env.BASE_URL is '/' and window.location.href is 'http://localhost:3000/' in this test environment (both verified empirically), matching what registerServiceWorker itself resolves.
const OWN_SW_URL = 'http://localhost:3000/sw.js';
const FOREIGN_SW_URL = 'http://localhost:3000/unrelated-app/sw.js';

// QNBS-v3: real browsers update navigator.serviceWorker.controller to the new controller BEFORE dispatching controllerchange — a static mock controller that never changes would hide the exact "listener must re-check the post-change controller" gap this helper exists to exercise.
function setMockController(scriptURL: string | null): void {
  Object.defineProperty(navigator.serviceWorker, 'controller', {
    value: scriptURL ? { scriptURL } : null,
    writable: true,
    configurable: true,
  });
}

describe('register-sw — controllerchange flush-then-reload (DA-02)', () => {
  let controllerChangeHandler: (() => void) | undefined;
  let reloadSpy: ReturnType<typeof vi.fn>;

  // QNBS-v3: defined inside describe() to close over controllerChangeHandler, which each test's mock setup reassigns.
  function fireControllerChange(scriptURL: string | null = OWN_SW_URL): void {
    setMockController(scriptURL);
    // QNBS-v3: registerServiceWorker() swallows setup errors, so an undefined handler here would make a test with only negative assertions pass without the classification path ever running — asserting this centrally protects every caller.
    expect(controllerChangeHandler).toBeTypeOf('function');
    controllerChangeHandler?.();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
      // QNBS-v3: an 'activated' (not merely 'activating') worker at this app's own script URL represents a returning visitor whose prior install already completed — the update path this default mock exercises.
      active: { state: 'activated', scriptURL: OWN_SW_URL },
      addEventListener: vi.fn(),
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(fakeRegistration),
        getRegistration: vi.fn().mockResolvedValue(fakeRegistration),
        controller: { scriptURL: OWN_SW_URL },
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });

    // QNBS-v3: a stable reference with real RootState shape — persistedSlices() reads project.present, matching production where project is never undefined.
    const stableState = {
      project: { present: { fake: 'state' } },
      versionControl: {},
      settings: {},
    };
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

    fireControllerChange();
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

    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a second controllerchange event (single-flight)', async () => {
    mockFlushPersistedState.mockResolvedValue(undefined);
    await registerServiceWorker();

    fireControllerChange();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('still reloads when no store is mounted yet (defensive null-guard, nothing to flush)', async () => {
    appStoreRef.current = null;
    await registerServiceWorker();

    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: only the visible tab flushes — a hidden tab's state can't safely be assumed fresher than what's already persisted.
  it('defers reload while the tab is hidden, then reloads once visible without flushing again', async () => {
    mockFlushPersistedState.mockResolvedValue(undefined);
    await registerServiceWorker();
    setVisibility('hidden');

    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flushMicrotasks();

    // QNBS-v3: index.tsx's own visibilitychange listener already attempted a flush when this tab went hidden — flushing its possibly-stale copy again could clobber a fresher write from another tab.
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: a single snapshot could miss an edit made while the async write is still in flight.
  it('re-flushes with the latest state when it changes during the pending flush, before reloading', async () => {
    const stateA = { project: { present: { v: 'a' } }, versionControl: {}, settings: {} };
    const stateB = { project: { present: { v: 'b' } }, versionControl: {}, settings: {} };
    // 1st getState(): stateA. 2nd (after flush #1): stateB (changed — retry). 3rd (after flush #2): stateB (stable — stop).
    const getStateMock = vi
      .fn()
      .mockReturnValueOnce(stateA)
      .mockReturnValueOnce(stateB)
      .mockReturnValue(stateB);
    appStoreRef.current = { getState: getStateMock, dispatch: vi.fn() as never };
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(2);
    expect(mockFlushPersistedState).toHaveBeenNthCalledWith(1, stateA);
    expect(mockFlushPersistedState).toHaveBeenNthCalledWith(2, stateB);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const lastFlushOrder = mockFlushPersistedState.mock.invocationCallOrder[1] as number;
    const reloadOrder = reloadSpy.mock.invocationCallOrder[0] as number;
    expect(lastFlushOrder).toBeLessThan(reloadOrder);
  });

  // QNBS-v3: the retry loop can exhaust its budget while state keeps changing — one guaranteed final flush must still capture whatever's freshest, not silently drop it.
  it('performs one final guaranteed flush of the freshest state after exhausting the retry budget', async () => {
    const states = Array.from({ length: 7 }, (_, i) => ({
      project: { present: { v: i } },
      versionControl: {},
      settings: {},
    }));
    const getStateMock = vi.fn();
    for (const s of states) getStateMock.mockReturnValueOnce(s);
    appStoreRef.current = { getState: getStateMock, dispatch: vi.fn() as never };
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    // 5 in-loop attempts (states[0..4]) + 1 guaranteed final flush of the freshest state (states[6]).
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(6);
    expect(mockFlushPersistedState).toHaveBeenNthCalledWith(6, states[6]);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: comparing the whole root state retried on unrelated non-persisted churn (e.g. status.saving), wasting the retry budget on noise instead of real edits.
  it('does not retry when only a non-persisted slice changes between getState() calls', async () => {
    const project = { present: { v: 'a' } };
    const versionControl = {};
    const settings = {};
    // Same persisted slices every call — only the non-persisted `status` field differs.
    const getStateMock = vi
      .fn()
      .mockReturnValueOnce({ project, versionControl, settings, status: { saving: 'saving' } })
      .mockReturnValue({ project, versionControl, settings, status: { saving: 'saved' } });
    appStoreRef.current = { getState: getStateMock, dispatch: vi.fn() as never };
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: versionControl mixes persisted fields (branches/snapshots/currentBranchId) with a UI-only isPanelOpen toggle — must compare only the former.
  it('does not retry when only versionControl.isPanelOpen changes, not the persisted version-control fields', async () => {
    const project = { present: { v: 'a' } };
    const settings = {};
    const branches = [{ id: 'main' }];
    const snapshots: unknown[] = [];
    const currentBranchId = 'main';
    const getStateMock = vi
      .fn()
      .mockReturnValueOnce({
        project,
        versionControl: { branches, snapshots, currentBranchId, isPanelOpen: false },
        settings,
      })
      .mockReturnValue({
        project,
        versionControl: { branches, snapshots, currentBranchId, isPanelOpen: true },
        settings,
      });
    appStoreRef.current = { getState: getStateMock, dispatch: vi.fn() as never };
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a fresh browser context's activate→clients.claim() also fires controllerchange on the page that just loaded, but there is no prior version to reload away from.
  it('does not flush or reload on a first-ever install (no registration existed before registering)', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue(undefined),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // QNBS-v3: regression guard — classification must finalize even when getRegistration() rejects, or every controllerchange for the rest of the page's lifetime stays queued forever and a genuine later update never reloads.
  it('finalizes classification even when getRegistration() rejects, so a later genuine update still reloads', async () => {
    const registerMock = vi.fn().mockResolvedValue({
      scope: '/',
      installing: null,
      waiting: null,
      addEventListener: vi.fn(),
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: registerMock,
        getRegistration: vi.fn().mockRejectedValue(new Error('getRegistration failed')),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    // QNBS-v3: a getRegistration() lookup failure must not abort registration itself — a fresh client would otherwise get no worker at all (no offline support), and a returning client would never receive swRegistration or its update-notification hooks.
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(window.worldScriptPWA.swRegistration).not.toBeNull();

    // First claim with no positive evidence and a failed getRegistration() defaults to first-install — no reload.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();

    // A later genuine update on the same tab must still reload — proving classification finalized instead of leaving events queued forever.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a getRegistration() rejection must not finalize classification on zero evidence when register()'s own idempotent result immediately afterward proves this is actually a returning visitor, or a genuine update would be wrongly treated as first-install and skip its needed reload after caches were already pruned.
  it("recovers classification from register()'s own result when getRegistration() rejected but the worker was already activated", async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          active: { state: 'activated', scriptURL: OWN_SW_URL },
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockRejectedValue(new Error('getRegistration failed')),
        // Force-refresh: no controller for this navigation despite a fully-activated own worker.
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    // Correctly reloads — recovered as a returning visitor via register()'s result, not misclassified as first-install.
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // The recovery path backfills the persistent record exactly like a successful getRegistration() would have.
    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBe('1');
  });

  // QNBS-v3: regression guard — a controllerchange firing while register() itself is still pending, during the getRegistration()-failure recovery window, must be queued (classification isn't finalized yet) and correctly replayed as a genuine update once register()'s result recovers classification — not lost, and not guessed at prematurely.
  it("queues a controllerchange firing during register()'s own await in the getRegistration()-failure recovery window, and replays it correctly", async () => {
    let capturedHandler: (() => void) | undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockImplementation(async () => {
          // Simulates another tab's genuine update completing its claim while register() is still pending.
          setMockController(OWN_SW_URL);
          capturedHandler?.();
          return {
            scope: '/',
            installing: null,
            waiting: null,
            active: { state: 'activated', scriptURL: OWN_SW_URL },
            addEventListener: vi.fn(),
          };
        }),
        getRegistration: vi.fn().mockRejectedValue(new Error('getRegistration failed')),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') {
            controllerChangeHandler = handler;
            capturedHandler = handler;
          }
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — if BOTH getRegistration() and register() fail, classification must still resolve to a safe default instead of leaving every future controllerchange queued forever with nothing left in the call stack to ever drain it.
  it('finalizes to a safe first-install default when both getRegistration() and register() reject, so a later controllerchange still resolves instead of queuing forever', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockRejectedValue(new Error('register failed')),
        getRegistration: vi.fn().mockRejectedValue(new Error('getRegistration failed')),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();

    // Safe default (no evidence either way): treated as first-install — no reload.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();

    // A later event on the same tab must still resolve deterministically — proving the queue actually drained instead of accepting events forever.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a second tab opened during the very same first-ever install observes the first tab's already-created but not-yet-active registration; that must still count as "no prior install" for both tabs, not as a genuine update.
  it("does not flush or reload when getRegistration() finds another tab's in-progress (not yet active) first install", async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue({ scope: '/', active: null }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // QNBS-v3: regression guard — the spec populates .active as soon as a worker enters 'activating', before it actually finishes activating, so a second tab observing that in-between state must still treat it as the same still-in-progress first install, not a completed prior one.
  it("does not flush or reload when getRegistration().active exists but is only 'activating', not yet 'activated'", async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue({
          scope: '/',
          active: { state: 'activating', scriptURL: OWN_SW_URL },
        }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // QNBS-v3: regression guard — a force-refreshed returning visitor also has a null controller for that navigation (the browser bypasses SW control for it), but an existing registration proves this is not a first-ever install, so the genuine update must still reload.
  it('reloads on the first controllerchange when a registration already existed, even though this navigation has no controller', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        // QNBS-v3: an 'activated' worker at this app's own script URL represents a returning visitor's already-completed prior install, surviving even though this force-refreshed navigation itself has no controller.
        getRegistration: vi
          .fn()
          .mockResolvedValue({ scope: '/', active: { state: 'activated', scriptURL: OWN_SW_URL } }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    // QNBS-v3: this positive evidence must be backfilled to the persistent record immediately, not only once a controllerchange happens to fire in this session — a later force-refresh landing mid-transition would otherwise find no history to override live-API ambiguity.
    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBe('1');
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a genuine update's replacement worker briefly reads .active.state === 'activating' before finishing activation; the already-existing controller (an ordinary, non-force-refreshed returning visitor) is what must decide this is not a first install, independent of that transient registration state.
  it("reloads on the first controllerchange when a controller already existed, even though the replacement worker is only 'activating'", async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue({
          scope: '/',
          active: { state: 'activating', scriptURL: OWN_SW_URL },
        }),
        controller: { scriptURL: OWN_SW_URL },
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    // QNBS-v3: an own controller at load is positive evidence too — it must be backfilled to the persistent record immediately, the same as an own-activated registration.
    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBe('1');
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — the controllerchange listener must be attached before any await (getRegistration()/register()), so a claim event racing ahead of that async setup (e.g. a concurrent tab's install completing in between) is never silently missed by a not-yet-attached listener.
  it('does not miss a controllerchange that fires while getRegistration() is still pending', async () => {
    let capturedHandler: (() => void) | undefined;
    // QNBS-v3: a plain boolean, not an in-mock expect() — an assertion thrown inside this async mock would reject getRegistration()'s own promise, which registerServiceWorker()'s outer try/catch silently swallows, making the test pass vacuously either way instead of failing when the listener was attached too late.
    let wasHandlerAttachedWhenGetRegistrationRan = false;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        // QNBS-v3: simulates the claim firing mid-await — if the listener were attached after this call (as in the original ordering), capturedHandler would still be undefined here and this invocation would be silently lost.
        getRegistration: vi.fn().mockImplementation(async () => {
          wasHandlerAttachedWhenGetRegistrationRan = typeof capturedHandler === 'function';
          setMockController(OWN_SW_URL);
          capturedHandler?.();
          return undefined;
        }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') {
            controllerChangeHandler = handler;
            capturedHandler = handler;
          }
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    await flushMicrotasks();

    expect(wasHandlerAttachedWhenGetRegistrationRan).toBe(true);
    // The mid-await claim was this tab's genuine first-ever install claim — no flush/reload for it.
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // QNBS-v3: regression guard — a tab that already had a controller at load is a known returning visitor; a controllerchange firing before getRegistration() resolves must still reload for it, not be misread as this tab's own first-install claim just because the async classification hasn't narrowed the (otherwise still-provisional) flag yet.
  it('reloads on a controllerchange that fires while getRegistration() is pending, for a tab that already had a controller', async () => {
    let capturedHandler: (() => void) | undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockImplementation(async () => {
          setMockController(OWN_SW_URL);
          capturedHandler?.();
          return { scope: '/', active: { state: 'activated', scriptURL: OWN_SW_URL } };
        }),
        controller: { scriptURL: OWN_SW_URL },
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') {
            controllerChangeHandler = handler;
            capturedHandler = handler;
          }
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — once a real controllerchange has consumed the provisional first-install exemption, the later async classification (from getRegistration()) must not unconditionally recompute and overwrite it back to true, or a subsequent genuine update's reload would be wrongly skipped a second time.
  it('still reloads on a later genuine update after a mid-await first-install claim was already consumed', async () => {
    let capturedHandler: (() => void) | undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockImplementation(async () => {
          setMockController(OWN_SW_URL); // simulates this tab's own first-ever install claim, mid-await
          capturedHandler?.();
          return undefined; // consistent with a genuine first install: no prior registration existed
        }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') {
            controllerChangeHandler = handler;
            capturedHandler = handler;
          }
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    await flushMicrotasks();
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();

    // A later, separate controllerchange on this same long-lived tab is a genuine update.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — the first-install exemption must be one-shot. A tab that stayed open since a fresh install and outlives its own claim must still reload when a later, genuine update takes over.
  it('reloads on a second controllerchange even though the first one was the no-reload first-install claim', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue(undefined),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();

    // First claim: the tab's own first-ever install — no reload.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();

    // Second claim on the same long-lived tab: a later real update — must reload.
    fireControllerChange();
    await flushMicrotasks();
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a controller (or an active worker) belonging to an unrelated app on a shared origin (e.g. GitHub Pages) must never count as evidence of this app's own prior install.
  it("treats a controller as first-install evidence only if its scriptURL is this app's own", async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue(undefined),
        // A foreign app's worker already controls this shared origin — must not be mistaken for our own.
        controller: { scriptURL: FOREIGN_SW_URL },
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    // Correctly classified as this app's own first-ever install, ignoring the foreign controller.
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("treats a prior registration as first-install evidence only if its active worker's scriptURL is this app's own", async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        // An unrelated, broader-scoped app's registration is already fully activated on this shared origin.
        getRegistration: vi.fn().mockResolvedValue({
          scope: '/',
          active: { state: 'activated', scriptURL: FOREIGN_SW_URL },
        }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    // Correctly classified as this app's own first-ever install, ignoring the foreign registration.
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // QNBS-v3: regression guard — the controllerchange LISTENER fires for any controller change on the shared origin's navigator.serviceWorker, including a foreign, broader-scoped worker's own claim — that must be ignored outright, not just excluded from classification evidence, or it could consume the one-shot exemption and persist this app's own install record on a claim that was never actually this app's worker.
  it('ignores a controllerchange whose resulting controller belongs to a foreign worker, without consuming the first-install exemption or persisting a record', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue(undefined),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();

    // A foreign, broader-scoped worker on this shared origin claims the page — must be ignored entirely.
    fireControllerChange(FOREIGN_SW_URL);
    await flushMicrotasks();
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBeNull();

    // This app's own first-ever claim follows — still correctly treated as first-install, proving the
    // foreign event above did not consume the one-shot exemption.
    fireControllerChange(OWN_SW_URL);
    await flushMicrotasks();
    expect(mockFlushPersistedState).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBe('1');

    // A later genuine update on this same tab must still reload normally.
    fireControllerChange(OWN_SW_URL);
    await flushMicrotasks();
    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a force-refreshed returning visitor (no controller for this navigation) whose genuine update races ahead during getRegistration() must have that event queued, not guessed at, and correctly reloaded once classification confirms it was a real update.
  it('reloads a controllerchange that fires mid-getRegistration() for a force-refreshed returning visitor, once classification confirms a genuine update', async () => {
    let capturedHandler: (() => void) | undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        // QNBS-v3: simulates another tab's genuine update completing its claim while this force-refreshed tab's own getRegistration() is still pending.
        getRegistration: vi.fn().mockImplementation(async () => {
          setMockController(OWN_SW_URL);
          capturedHandler?.();
          return { scope: '/', active: { state: 'activated', scriptURL: OWN_SW_URL } };
        }),
        controller: null, // force-refresh: no controller for this navigation despite a fully-activated own worker
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') {
            controllerChangeHandler = handler;
            capturedHandler = handler;
          }
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — a persistent record from an earlier successful classification must make classification immediate and correct, bypassing every live-API ambiguity (force-refresh, mid-activation timing) entirely.
  it('reloads immediately on a force-refreshed visitor when a persistent prior-install record already exists, even with an activating replacement worker', async () => {
    localStorage.setItem(`worldscript-sw-installed:${OWN_SW_URL}`, '1');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        // Ambiguous live state on its own (no controller, worker still activating) — the persistent record must override it.
        getRegistration: vi.fn().mockResolvedValue({
          scope: '/',
          active: { state: 'activating', scriptURL: OWN_SW_URL },
        }),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    fireControllerChange();
    await flushMicrotasks();

    expect(mockFlushPersistedState).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: regression guard — the very first genuine claim (whichever classification) must persist a record so every future load for this app's scope can classify instantly and correctly, without depending on live-API timing at all.
  it("persists a prior-install record on the first genuine claim, scoped to this app's own script URL", async () => {
    // QNBS-v3: starts with no controller and no registration — the default fixture's own controller would satisfy this test via the hadOwnControllerAtLoad backfill instead of the claim path this test exists to cover.
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue({
          scope: '/',
          installing: null,
          waiting: null,
          addEventListener: vi.fn(),
        }),
        getRegistration: vi.fn().mockResolvedValue(undefined),
        controller: null,
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === 'controllerchange') controllerChangeHandler = handler;
        }),
      },
      writable: true,
      configurable: true,
    });
    mockFlushPersistedState.mockResolvedValue(undefined);

    await registerServiceWorker();
    // No positive evidence exists yet, so no backfill has happened.
    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBeNull();

    fireControllerChange();
    await flushMicrotasks();

    expect(localStorage.getItem(`worldscript-sw-installed:${OWN_SW_URL}`)).toBe('1');
  });

  // QNBS-v3: an unbounded wait (e.g. queued behind another tab's exclusive Web Lock) must not hang the reload forever on an already-cache-pruned bundle.
  it('reloads once the flush timeout elapses if the flush never settles', async () => {
    vi.useFakeTimers();
    try {
      mockFlushPersistedState.mockImplementation(() => new Promise(() => {}));
      await registerServiceWorker();
      fireControllerChange();

      await vi.advanceTimersByTimeAsync(0);
      expect(reloadSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(8000);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
