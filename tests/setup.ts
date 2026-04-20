// Global test setup for Vitest + React Testing Library
import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';

// Node 24 exposes a native localStorage that lacks .clear(), overriding jsdom's version.
// Replace it with a proper in-memory mock when the native one is broken.
const makeStorageMock = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    getItem(k: string) {
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  } as Storage;
};

if (typeof localStorage === 'undefined' || typeof localStorage.clear !== 'function') {
  Object.defineProperty(window, 'localStorage', {
    value: makeStorageMock(),
    writable: true,
    configurable: true,
  });
}

// Mock Web APIs not available in jsdom
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

// Mock IndexedDB
const mockIndexedDB = {
  open: vi.fn(),
};
Object.defineProperty(window, 'indexedDB', {
  writable: true,
  value: mockIndexedDB,
});

// Mock SpeechSynthesisUtterance (not available in jsdom)
if (!('SpeechSynthesisUtterance' in window)) {
  class SpeechSynthesisUtteranceMock {
    text: string;
    lang: string = '';
    rate: number = 1;
    pitch: number = 1;
    volume: number = 1;
    voice: SpeechSynthesisVoice | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  (window as unknown as Record<string, unknown>)['SpeechSynthesisUtterance'] =
    SpeechSynthesisUtteranceMock;
}

// Silence console noise in tests
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});
