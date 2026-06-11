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
