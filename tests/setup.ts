// Global test setup for Vitest + React Testing Library
import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';

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
