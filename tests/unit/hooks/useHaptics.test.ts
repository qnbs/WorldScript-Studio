/**
 * Tests for hooks/useHaptics.ts
 * QNBS-v3: Covers named pattern lookup, graceful degradation when navigator.vibrate absent.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHaptics } from '../../../hooks/useHaptics';

describe('useHaptics', () => {
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrateMock = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns canVibrate=true when navigator.vibrate exists', () => {
    const { result } = renderHook(() => useHaptics());
    expect(result.current.canVibrate).toBe(true);
  });

  it('calls navigator.vibrate with numeric pattern', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate(50);
    expect(vibrateMock).toHaveBeenCalledWith(50);
  });

  it('calls navigator.vibrate with array pattern', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate([10, 50, 10]);
    expect(vibrateMock).toHaveBeenCalledWith([10, 50, 10]);
  });

  it('resolves named pattern "scene-drop"', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate('scene-drop');
    expect(vibrateMock).toHaveBeenCalledWith([10, 50, 10]);
  });

  it('resolves named pattern "streak-milestone"', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate('streak-milestone');
    expect(vibrateMock).toHaveBeenCalledWith([50, 100, 50, 100, 200]);
  });

  it('resolves named pattern "goal-achieved"', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate('goal-achieved');
    expect(vibrateMock).toHaveBeenCalledWith([100, 50, 200, 50, 100]);
  });

  it('resolves named pattern "error" (single pulse)', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate('error');
    expect(vibrateMock).toHaveBeenCalledWith([80]);
  });

  it('uses default 10ms when vibrate called with no argument', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.vibrate();
    expect(vibrateMock).toHaveBeenCalledWith(10);
  });

  it('does not throw when navigator.vibrate throws', () => {
    vibrateMock.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    const { result } = renderHook(() => useHaptics());
    expect(() => result.current.vibrate('error')).not.toThrow();
  });

  describe('when navigator.vibrate is absent', () => {
    beforeEach(() => {
      vi.stubGlobal('navigator', {});
    });

    it('returns canVibrate=false', () => {
      const { result } = renderHook(() => useHaptics());
      expect(result.current.canVibrate).toBe(false);
    });

    it('vibrate() does nothing (no throw)', () => {
      const { result } = renderHook(() => useHaptics());
      expect(() => result.current.vibrate('scene-drop')).not.toThrow();
    });
  });
});
