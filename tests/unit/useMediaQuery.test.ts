/**
 * Tests for hooks/useMediaQuery.ts
 * QNBS-v3: Verifies initial match + reaction to a media-query change event.
 */

import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from '../../hooks/useMediaQuery';

function installMatchMedia(initial: boolean) {
  let matches = initial;
  let handler: (() => void) | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    media: '',
    addEventListener: (_: string, cb: () => void) => {
      handler = cb;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    fire(next: boolean) {
      matches = next;
      handler?.();
    },
  };
}

// QNBS-v3: older Safari/WebView MediaQueryList has no addEventListener — only the deprecated
// addListener/removeListener. The hook must fall back to those instead of throwing.
function installLegacyMatchMedia(initial: boolean) {
  let matches = initial;
  let handler: (() => void) | null = null;
  const removeListener = vi.fn();
  const mql = {
    get matches() {
      return matches;
    },
    media: '',
    addListener: (cb: () => void) => {
      handler = cb;
    },
    removeListener,
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    removeListener,
    fire(next: boolean) {
      matches = next;
      handler?.();
    },
  };
}

describe('useMediaQuery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the initial match state', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    const mm = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
    act(() => mm.fire(true));
    expect(result.current).toBe(true);
  });

  it('falls back to addListener/removeListener on legacy engines without addEventListener', () => {
    const mm = installLegacyMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
    act(() => mm.fire(true));
    expect(result.current).toBe(true);
    unmount();
    expect(mm.removeListener).toHaveBeenCalled();
  });

  it('evaluates innerWidth + tracks resize when matchMedia is unavailable', () => {
    // No matchMedia at all (very old/non-standard runtime) — must NOT stay stuck at false.
    vi.stubGlobal('matchMedia', undefined);
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true); // 1024 >= 768
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false); // 500 < 768
  });
});
