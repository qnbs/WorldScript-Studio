import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFoldableLayout } from '../../hooks/useFoldableLayout';

describe('useFoldableLayout', () => {
  // biome-ignore lint/correctness/noUnusedVariables: used inside test callbacks via closure
  let getComputedStyleMock: ReturnType<typeof vi.spyOn>;

  const makeMediaQuery = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  beforeEach(() => {
    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el);
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);
    vi.spyOn(window, 'matchMedia').mockReturnValue(makeMediaQuery() as unknown as MediaQueryList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no-fold state by default (no fold CSS env)', () => {
    getComputedStyleMock = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ height: '0px' } as CSSStyleDeclaration);
    const { result } = renderHook(() => useFoldableLayout());
    expect(result.current.isFolded).toBe(false);
    expect(result.current.foldAxis).toBeNull();
    expect(result.current.foldPosition).toBeNull();
  });

  it('detects horizontal fold when fold-top is non-zero', () => {
    let callCount = 0;
    getComputedStyleMock = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      callCount++;
      return { height: callCount === 1 ? '200px' : '0px' } as CSSStyleDeclaration;
    });

    const { result } = renderHook(() => useFoldableLayout());
    expect(result.current.isFolded).toBe(true);
    expect(result.current.foldAxis).toBe('horizontal');
    expect(result.current.foldPosition).toBe(200);
  });

  it('detects vertical fold when fold-left is non-zero', () => {
    let callCount = 0;
    getComputedStyleMock = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      callCount++;
      return { height: callCount === 1 ? '0px' : '400px' } as CSSStyleDeclaration;
    });

    const { result } = renderHook(() => useFoldableLayout());
    expect(result.current.isFolded).toBe(true);
    expect(result.current.foldAxis).toBe('vertical');
    expect(result.current.foldPosition).toBe(400);
  });

  it('falls back to no-fold when getComputedStyle throws', () => {
    getComputedStyleMock = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('CSS env unsupported');
    });

    const { result } = renderHook(() => useFoldableLayout());
    expect(result.current.isFolded).toBe(false);
    expect(result.current.foldAxis).toBeNull();
  });

  it('registers resize listener on mount', () => {
    const addEventSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    getComputedStyleMock = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ height: '0px' } as CSSStyleDeclaration);

    renderHook(() => useFoldableLayout());
    expect(addEventSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('removes resize listener on unmount', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    getComputedStyleMock = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ height: '0px' } as CSSStyleDeclaration);

    const { unmount } = renderHook(() => useFoldableLayout());
    unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
