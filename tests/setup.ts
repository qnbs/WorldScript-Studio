// tests/setup.ts
// Globale Test-Setup für Vitest 4 + React Testing Library + Node 24/25+ Kompatibilität
// QNBS-v3: Robuste Polyfills für Node 24+ native Web Storage API, die jsdom überschreibt
import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';

// Wichtiger Import für vollwertiges IndexedDB (besser als der minimale Mock)
import 'fake-indexeddb/auto';

// QNBS-v3: `@vitest-environment node` (e.g. dbInitialization tests) has no `window`; mirror globalThis.
// This ensures node-environment tests can still access window-indexedDB mocks.
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

// ============================================================
// 1. Web Storage API (localStorage + sessionStorage) – Node 24/25 Fix
// QNBS-v3: Node.js liefert ab v24 eine native (aber unvollständige) localStorage-Implementierung.
// jsdom wird dadurch überschrieben → wir erzwingen eine korrekte jsdom-kompatible Version.
// WHY: Ohne --localstorage-file liefert Node in v24/v25 ein unvollständiges Objekt, in v26 sogar DOMException.
// Best Practice 2026: Immer auf globalThis + window setzen, nie nur auf window.
// ============================================================
const createStorageMock = (): Storage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  } as Storage;
};

const setupStorage = (name: 'localStorage' | 'sessionStorage') => {
  const mock = createStorageMock();

  // Auf globalThis (Node) und window (jsdom) überschreiben
  // WHY: Node 24 native Storage exists on globalThis, jsdom on window - both must be consistent
  Object.defineProperty(globalThis, name, {
    value: mock,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: mock,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
};

// Immer ausführen – auch wenn Node bereits etwas bereitstellt
// WHY: Prevents shadowing by Node 24+ native incomplete implementation
setupStorage('localStorage');
setupStorage('sessionStorage');

// ============================================================
// 2. Weitere häufig fehlende / kollidierende Web APIs (Node 24)
// QNBS-v3: ResizeObserver & IntersectionObserver werden von modernen UI-Komponenten verwendet.
// Best Practice 2026: Defensive checks prevent duplicate definition errors.
// ============================================================

// matchMedia (wird von vielen UI-Komponenten verwendet)
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// speechSynthesis (für Voice-Features)
if (typeof window !== 'undefined' && !window.speechSynthesis) {
  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
      speaking: false,
      paused: false,
      pending: false,
    },
  });
}

// SpeechSynthesisUtterance
// QNBS-v3: Test mock assignment to window object.
// Using bracket notation to satisfy TypeScript 4111 (index signature property access).
if (typeof window !== 'undefined' && !('SpeechSynthesisUtterance' in window)) {
  class SpeechSynthesisUtteranceMock {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: SpeechSynthesisVoice | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  }
  // QNBS-v3: Bracket notation required for Record<string, unknown> index signature access
  (window as unknown as Record<string, unknown>)['SpeechSynthesisUtterance'] =
    SpeechSynthesisUtteranceMock;
}

// navigator.locks (Web Locks API) — jsdom does not implement it, and Node has no navigator at all.
// QNBS-v3: minimal fair reader/writer mutex per lock name, enough fidelity for protectedWriteAdmission.ts without a full spec-accurate implementation.
if (typeof navigator === 'undefined') {
  (globalThis as unknown as { navigator: unknown }).navigator = {};
}
if (!('locks' in navigator) || !navigator.locks) {
  const activeSharedByName = new Map<string, number>();
  const exclusiveHeldByName = new Set<string>();
  type Waiter = { mode: 'shared' | 'exclusive'; resolve: () => void };
  const waiters = new Map<string, Waiter[]>();

  function hasQueuedExclusive(name: string): boolean {
    return (waiters.get(name) ?? []).some((w) => w.mode === 'exclusive');
  }

  // QNBS-v3: wakes the queue's leading exclusive waiter alone, or every leading shared waiter together — prevents new shared requests from barging a queued exclusive one.
  function wakeNext(name: string): void {
    const queue = waiters.get(name);
    if (!queue || queue.length === 0) return;
    if (queue[0]!.mode === 'exclusive') {
      queue.shift()!.resolve();
      return;
    }
    while (queue.length > 0 && queue[0]!.mode === 'shared') {
      queue.shift()!.resolve();
    }
  }

  async function acquire(name: string, mode: 'shared' | 'exclusive'): Promise<() => void> {
    while (
      exclusiveHeldByName.has(name) ||
      (mode === 'exclusive' && (activeSharedByName.get(name) ?? 0) > 0) ||
      (mode === 'shared' && hasQueuedExclusive(name))
    ) {
      await new Promise<void>((resolve) => {
        const queue = waiters.get(name) ?? [];
        queue.push({ mode, resolve });
        waiters.set(name, queue);
      });
    }
    if (mode === 'exclusive') {
      exclusiveHeldByName.add(name);
      return () => {
        exclusiveHeldByName.delete(name);
        wakeNext(name);
      };
    }
    activeSharedByName.set(name, (activeSharedByName.get(name) ?? 0) + 1);
    return () => {
      const remaining = (activeSharedByName.get(name) ?? 1) - 1;
      activeSharedByName.set(name, remaining);
      if (remaining === 0) wakeNext(name);
    };
  }

  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    writable: true,
    value: {
      request: async <T>(
        name: string,
        optionsOrCallback: { mode?: 'shared' | 'exclusive' } | (() => T | Promise<T>),
        maybeCallback?: () => T | Promise<T>,
      ): Promise<T> => {
        const isCallbackOnly = typeof optionsOrCallback === 'function';
        const callback = isCallbackOnly ? optionsOrCallback : maybeCallback!;
        // QNBS-v3: LockManager.request()'s 2-arg form defaults to 'exclusive' per spec, not 'shared'.
        const mode = isCallbackOnly
          ? 'exclusive'
          : optionsOrCallback.mode === 'shared'
            ? 'shared'
            : 'exclusive';
        const release = await acquire(name, mode);
        try {
          return await callback();
        } finally {
          release();
        }
      },
    },
  });
}

// ResizeObserver & IntersectionObserver (sehr häufig in modernen React-Komponenten)
// QNBS-v3: These APIs are used by container-query components and lazy-loading features.
if (typeof window !== 'undefined') {
  if (!('ResizeObserver' in window)) {
    // QNBS-v3: Bracket notation required for Record<string, unknown> index signature access
    (window as unknown as Record<string, unknown>)['ResizeObserver'] = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
  if (!('IntersectionObserver' in window)) {
    // QNBS-v3: Bracket notation required for Record<string, unknown> index signature access
    (window as unknown as Record<string, unknown>)['IntersectionObserver'] = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn().mockReturnValue([]);
    };
  }
}

// ============================================================
// 3. Console-Silencing + Cleanup (wie bisher, aber verbessert)
// QNBS-v3: Explicit storage cleanup after each test ensures isolation.
// Best Practice 2026: Clear storages to prevent cross-test contamination.
// ============================================================
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // QNBS-v3: Storage cleanup for test isolation (Node 24+ compatibility)
  // Using bracket notation to satisfy TypeScript 4111 (index signature property access)
  const storage = globalThis as unknown as Record<string, { clear?: () => void }>;
  storage['localStorage']?.clear?.();
  storage['sessionStorage']?.clear?.();
});
