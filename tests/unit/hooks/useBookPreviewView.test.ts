/**
 * Tests for hooks/useBookPreviewView.ts
 * QNBS-v3: Covers font controls, fullscreen toggle, TOC, word count, section scrolling.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// IntersectionObserver is not in jsdom — provide a constructor-compatible stub
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const SEC_1 = { id: 'sec-1', title: 'Prologue', content: 'Once upon a time...' };
const SEC_2 = { id: 'sec-2', title: 'Chapter 1', content: 'The journey begins.' };

let mockSections = [SEC_1, SEC_2];

vi.mock('../../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      project: { present: { data: { manuscript: mockSections } } },
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectManuscript: (s: { project: { present: { data: { manuscript: typeof mockSections } } } }) =>
    s.project.present.data.manuscript,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useTransientUiStore } from '../../../app/transientUiStore';
import { useBookPreviewView } from '../../../hooks/useBookPreviewView';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBookPreviewView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSections = [{ ...SEC_1 }, { ...SEC_2 }];
    // QNBS-v3: reading prefs persist to localStorage — clear so each test starts from defaults.
    localStorage.clear();
    useTransientUiStore.getState().setExportInitialFormat(null);
  });

  it('returns sections from Redux', () => {
    const { result } = renderHook(() => useBookPreviewView());
    expect(result.current.sections).toHaveLength(2);
  });

  it('initializes with default fontSize=16 and fontFamily=system-ui', () => {
    const { result } = renderHook(() => useBookPreviewView());
    expect(result.current.fontSize).toBe(16);
    expect(result.current.fontFamily).toBe('system-ui');
  });

  it('initializes showWordCount=false, isFullscreen=false, isTocOpen=false', () => {
    const { result } = renderHook(() => useBookPreviewView());
    expect(result.current.showWordCount).toBe(false);
    expect(result.current.isFullscreen).toBe(false);
    expect(result.current.isTocOpen).toBe(false);
  });

  it('initializes isPaginated=false', () => {
    const { result } = renderHook(() => useBookPreviewView());
    expect(result.current.isPaginated).toBe(false);
  });

  describe('setFontSize', () => {
    it('updates fontSize', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.setFontSize(20));
      expect(result.current.fontSize).toBe(20);
    });

    it('clamps to 12 minimum', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.setFontSize(8));
      expect(result.current.fontSize).toBe(12);
    });

    it('clamps to 24 maximum', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.setFontSize(30));
      expect(result.current.fontSize).toBe(24);
    });
  });

  describe('setFontFamily', () => {
    it('accepts "serif"', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.setFontFamily('serif'));
      expect(result.current.fontFamily).toBe('serif');
    });

    it('accepts "monospace"', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.setFontFamily('monospace'));
      expect(result.current.fontFamily).toBe('monospace');
    });

    it('ignores unknown font families', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.setFontFamily('Comic Sans'));
      expect(result.current.fontFamily).toBe('system-ui'); // unchanged
    });
  });

  describe('toggleWordCount', () => {
    it('toggles showWordCount', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.toggleWordCount());
      expect(result.current.showWordCount).toBe(true);
      act(() => result.current.toggleWordCount());
      expect(result.current.showWordCount).toBe(false);
    });
  });

  describe('toggleFullscreen', () => {
    it('toggles isFullscreen', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.toggleFullscreen());
      expect(result.current.isFullscreen).toBe(true);
      act(() => result.current.toggleFullscreen());
      expect(result.current.isFullscreen).toBe(false);
    });
  });

  describe('ESC key closes fullscreen', () => {
    it('sets isFullscreen=false when Escape is pressed while in fullscreen', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.toggleFullscreen());
      expect(result.current.isFullscreen).toBe(true);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      expect(result.current.isFullscreen).toBe(false);
    });
  });

  describe('toggleToc', () => {
    it('toggles isTocOpen', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.toggleToc());
      expect(result.current.isTocOpen).toBe(true);
      act(() => result.current.toggleToc());
      expect(result.current.isTocOpen).toBe(false);
    });
  });

  describe('togglePaginated', () => {
    it('toggles isPaginated', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.togglePaginated());
      expect(result.current.isPaginated).toBe(true);
      act(() => result.current.togglePaginated());
      expect(result.current.isPaginated).toBe(false);
    });
  });

  describe('persistence', () => {
    it('restores persisted preferences on mount', () => {
      const first = renderHook(() => useBookPreviewView());
      act(() => first.result.current.setFontSize(22));
      act(() => first.result.current.togglePaginated());
      first.unmount();

      const second = renderHook(() => useBookPreviewView());
      expect(second.result.current.fontSize).toBe(22);
      expect(second.result.current.isPaginated).toBe(true);
    });
  });

  describe('onExport', () => {
    it('navigates to the export view and preselects EPUB', () => {
      const onNavigate = vi.fn();
      const { result } = renderHook(() => useBookPreviewView(onNavigate));
      act(() => result.current.onExport());
      expect(onNavigate).toHaveBeenCalledWith('export');
      expect(useTransientUiStore.getState().exportInitialFormat).toBe('epub');
    });

    it('does not set the preselection flag when no navigation callback is provided', () => {
      const { result } = renderHook(() => useBookPreviewView());
      act(() => result.current.onExport());
      expect(useTransientUiStore.getState().exportInitialFormat).toBeNull();
    });
  });
});
