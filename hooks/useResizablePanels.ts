import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// QNBS-v3: Extracted from ManuscriptView — reusable for any future 3-panel layout.
const throttle = <A extends readonly unknown[]>(fn: (...args: A) => void, delay = 16) => {
  let lastCall = 0;
  return ((...args: A) => {
    const now = performance.now();
    if (now - lastCall < delay) return;
    lastCall = now;
    fn(...args);
  }) as typeof fn;
};

export const useResizablePanels = (initialLeft = 20, initialRight = 20) => {
  const [leftPanelWidth, setLeftPanelWidth] = useState(initialLeft);
  const [rightPanelWidth, setRightPanelWidth] = useState(initialRight);
  const [activeResize, setActiveResize] = useState<'left' | 'right' | null>(null);
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);

  // QNBS-v3 (#179): track both widths in a ref so the stable drag handlers can enforce a COMBINED
  // constraint — left + right ≤ 80%, keeping ≥ 20% for the center editor. Clamping each side
  // independently to 15–50% let a drag collapse the editor once both panels reached ~50%.
  const widthsRef = useRef({ left: initialLeft, right: initialRight });
  widthsRef.current = { left: leftPanelWidth, right: rightPanelWidth };

  // QNBS-v3: PointerEvent replaces MouseEvent for reliable mobile drag (touch + stylus + mouse).
  const handleLeftResize = useCallback((e: PointerEvent) => {
    if (!isResizingLeft.current) return;
    const newWidth = (e.clientX / window.innerWidth) * 100;
    const maxLeft = Math.min(50, 80 - widthsRef.current.right);
    if (newWidth > 15 && newWidth < maxLeft) {
      setLeftPanelWidth(newWidth);
    }
  }, []);

  const handleRightResize = useCallback((e: PointerEvent) => {
    if (!isResizingRight.current) return;
    const newWidth = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
    const maxRight = Math.min(50, 80 - widthsRef.current.left);
    if (newWidth > 15 && newWidth < maxRight) {
      setRightPanelWidth(newWidth);
    }
  }, []);

  const stopResizing = useCallback((e: PointerEvent) => {
    const el = e.currentTarget as Element | null;
    if (el && 'releasePointerCapture' in el) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    isResizingLeft.current = false;
    isResizingRight.current = false;
    setActiveResize(null);
    document.body.style.cursor = 'default';
  }, []);

  const startLeftResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // QNBS-v3: setPointerCapture ensures pointermove fires even when cursor leaves the handle.
    e.currentTarget.setPointerCapture(e.pointerId);
    isResizingLeft.current = true;
    isResizingRight.current = false;
    setActiveResize('left');
    document.body.style.cursor = 'col-resize';
  }, []);

  const startRightResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isResizingRight.current = true;
    isResizingLeft.current = false;
    setActiveResize('right');
    document.body.style.cursor = 'col-resize';
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    if (!activeResize) {
      return () => {
        controller.abort();
      };
    }

    const handleMove = (e: PointerEvent) => {
      if (activeResize === 'left') {
        handleLeftResize(e);
      }
      if (activeResize === 'right') {
        handleRightResize(e);
      }
    };

    const throttledMove = throttle(handleMove, 16);

    window.addEventListener('pointermove', throttledMove, { signal: controller.signal });
    window.addEventListener('pointerup', stopResizing, { signal: controller.signal });

    return () => {
      window.removeEventListener('pointermove', throttledMove);
      window.removeEventListener('pointerup', stopResizing);
      controller.abort();
    };
  }, [activeResize, handleLeftResize, handleRightResize, stopResizing]);

  return {
    leftPanelWidth,
    rightPanelWidth,
    startLeftResize,
    startRightResize,
    setLeftPanelWidth,
    setRightPanelWidth,
  };
};
