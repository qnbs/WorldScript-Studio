import { type RefObject, useEffect } from 'react';

interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** Minimum px distance before a swipe is recognised (default 50). */
  threshold?: number;
  /** Maximum ms the gesture may take (default 300). */
  velocityWindow?: number;
}

/**
 * Attach swipe-gesture detection to a DOM element via PointerEvent.
 * QNBS-v3: PointerEvent unifies touch, stylus, and mouse; no separate touch/mouse branches needed.
 */
export function useSwipeGesture(
  ref: RefObject<Element | null>,
  options: SwipeGestureOptions,
): void {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    velocityWindow = 300,
  } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let activePointerId: number | null = null;

    function onPointerDown(e: PointerEvent) {
      if (activePointerId !== null) return;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startTime = performance.now();
    }

    function onPointerUp(e: PointerEvent) {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;

      const elapsed = performance.now() - startTime;
      if (elapsed > velocityWindow) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < threshold && absDy < threshold) return;

      // Dominant axis determines direction
      if (absDx >= absDy) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
      } else {
        if (dy < 0) onSwipeUp?.();
        else onSwipeDown?.();
      }
    }

    function onPointerCancel() {
      activePointerId = null;
    }

    el.addEventListener('pointerdown', onPointerDown as EventListener);
    el.addEventListener('pointerup', onPointerUp as EventListener);
    el.addEventListener('pointercancel', onPointerCancel);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown as EventListener);
      el.removeEventListener('pointerup', onPointerUp as EventListener);
      el.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [ref, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, velocityWindow]);
}
