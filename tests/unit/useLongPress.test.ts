import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from '../../hooks/useLongPress';

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makePointerEvent(type: string, x = 100, y = 100): React.PointerEvent {
    return {
      pointerId: 1,
      clientX: x,
      clientY: y,
      nativeEvent: new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y }),
      currentTarget: document.createElement('div'),
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent;
  }

  it('fires callback after the default ms duration', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useLongPress(callback, 600));

    act(() => {
      result.current.onPointerDown(makePointerEvent('pointerdown'));
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does NOT fire if pointer is released before timeout', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useLongPress(callback, 600));

    act(() => {
      result.current.onPointerDown(makePointerEvent('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    act(() => {
      result.current.onPointerUp(makePointerEvent('pointerup'));
    });
    act(() => {
      vi.advanceTimersByTime(300);
    }); // advance past original timeout
    expect(callback).not.toHaveBeenCalled();
  });

  it('does NOT fire when pointer moves more than 10px', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useLongPress(callback, 600));

    act(() => {
      result.current.onPointerDown(makePointerEvent('pointerdown', 100, 100));
    });
    act(() => {
      result.current.onPointerMove(makePointerEvent('pointermove', 115, 100));
    }); // dx=15 > 10
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('fires when pointer moves within 10px', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useLongPress(callback, 400));

    act(() => {
      result.current.onPointerDown(makePointerEvent('pointerdown', 100, 100));
    });
    act(() => {
      result.current.onPointerMove(makePointerEvent('pointermove', 107, 103));
    }); // < 10px
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does NOT fire after onPointerCancel', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useLongPress(callback, 600));

    act(() => {
      result.current.onPointerDown(makePointerEvent('pointerdown'));
    });
    act(() => {
      result.current.onPointerCancel(makePointerEvent('pointercancel'));
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('respects custom ms duration', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useLongPress(callback, 1200));

    act(() => {
      result.current.onPointerDown(makePointerEvent('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(callback).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledOnce();
  });
});
