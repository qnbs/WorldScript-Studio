import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';

// ---------------------------------------------------------------------------
// Helpers — simulate PointerEvent sequences on an element
// ---------------------------------------------------------------------------

function makePointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, ...init });
}

function fireSwipe(
  el: Element,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  delayMs = 100,
) {
  // Simulate fast swipe within velocityWindow (default 300ms)
  let callCount = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    // first call = startTime, second call = endTime
    return callCount++ === 0 ? 1000 : 1000 + delayMs;
  });

  el.dispatchEvent(
    makePointerEvent('pointerdown', { pointerId: 1, clientX: startX, clientY: startY }),
  );
  el.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: endX, clientY: endY }));

  vi.restoreAllMocks();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSwipeGesture', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('calls onSwipeLeft when swiped left beyond threshold', () => {
    const onSwipeLeft = vi.fn();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useSwipeGesture(ref, { onSwipeLeft, threshold: 50 });
      return ref;
    });
    expect(result.current.current).toBe(container);

    fireSwipe(container, 200, 100, 140, 100); // dx = -60 > threshold 50
    expect(onSwipeLeft).toHaveBeenCalledOnce();
  });

  it('calls onSwipeRight when swiped right beyond threshold', () => {
    const onSwipeRight = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useSwipeGesture(ref, { onSwipeRight, threshold: 50 });
    });

    fireSwipe(container, 100, 100, 165, 100); // dx = +65
    expect(onSwipeRight).toHaveBeenCalledOnce();
  });

  it('calls onSwipeUp for dominant upward motion', () => {
    const onSwipeUp = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useSwipeGesture(ref, { onSwipeUp, threshold: 30 });
    });

    fireSwipe(container, 100, 200, 105, 130); // dy = -70, dx = 5 → up dominant
    expect(onSwipeUp).toHaveBeenCalledOnce();
  });

  it('calls onSwipeDown for dominant downward motion', () => {
    const onSwipeDown = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useSwipeGesture(ref, { onSwipeDown, threshold: 30 });
    });

    fireSwipe(container, 100, 100, 105, 180); // dy = +80 → down dominant
    expect(onSwipeDown).toHaveBeenCalledOnce();
  });

  it('does NOT fire when distance is below threshold', () => {
    const onSwipeLeft = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useSwipeGesture(ref, { onSwipeLeft, threshold: 50 });
    });

    fireSwipe(container, 100, 100, 70, 100); // dx = -30 < threshold 50
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('does NOT fire when swipe is too slow (beyond velocityWindow)', () => {
    const onSwipeLeft = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useSwipeGesture(ref, { onSwipeLeft, threshold: 50, velocityWindow: 200 });
    });

    fireSwipe(container, 200, 100, 100, 100, 250); // 250ms > 200ms window
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('does not fire if no onSwipeLeft handler is provided', () => {
    const onSwipeRight = vi.fn();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      // Only right handler — swipe left should be silently ignored
      useSwipeGesture(ref, { onSwipeRight, threshold: 50 });
    });

    // Should not throw even if onSwipeLeft is undefined
    expect(() => fireSwipe(container, 200, 100, 100, 100)).not.toThrow();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });
});
