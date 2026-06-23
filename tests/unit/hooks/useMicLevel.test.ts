import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMicLevel } from '../../../hooks/useMicLevel';

// jsdom exposes no Web Audio / getUserMedia, so the hook must feature-detect and no-op to 0.
describe('useMicLevel', () => {
  it('returns 0 when inactive', () => {
    const { result } = renderHook(() => useMicLevel(false));
    expect(result.current).toBe(0);
  });

  it('returns 0 (does not throw) when Web Audio / getUserMedia are unavailable', () => {
    const { result } = renderHook(() => useMicLevel(true));
    expect(result.current).toBe(0);
  });

  it('cleans up without error when toggled off and unmounted', () => {
    const { result, rerender, unmount } = renderHook(({ active }) => useMicLevel(active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    expect(result.current).toBe(0);
    expect(() => unmount()).not.toThrow();
  });
});
