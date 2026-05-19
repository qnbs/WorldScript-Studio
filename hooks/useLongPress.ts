import { useCallback, useRef } from 'react';

/**
 * Returns PointerEvent handlers that call `callback` when the pointer is held
 * for at least `ms` milliseconds without moving more than 10px.
 * QNBS-v3: PointerEvent-based so it works on touch, stylus, and mouse uniformly.
 */
export function useLongPress(
  callback: (e: PointerEvent) => void,
  ms = 600,
): {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    firedRef.current = false;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      clear();
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      firedRef.current = false;
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        callback(e.nativeEvent);
      }, ms);
    },
    [callback, ms, clear],
  );

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const dx = Math.abs(e.clientX - startXRef.current);
      const dy = Math.abs(e.clientY - startYRef.current);
      // QNBS-v3: Cancel if the pointer moved > 10px — that's a scroll/drag, not a press.
      if (dx > 10 || dy > 10) clear();
    },
    [clear],
  );

  const onPointerCancel = useCallback(() => {
    clear();
  }, [clear]);

  return { onPointerDown, onPointerUp, onPointerMove, onPointerCancel };
}
