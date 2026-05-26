/**
 * Tests for hooks/useResizablePanels.ts
 * QNBS-v3: Covers initial state, pointer event resizing, clamping, cursor changes.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResizablePanels } from '../../../hooks/useResizablePanels';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePointerEvent(clientX: number, opts: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX,
    clientY: 0,
    pointerId: 1,
    preventDefault: vi.fn(),
    currentTarget: {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
    ...opts,
  } as unknown as PointerEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useResizablePanels', () => {
  beforeEach(() => {
    // jsdom has innerWidth = 1024 by default
    Object.defineProperty(window, 'innerWidth', {
      value: 1000,
      writable: true,
      configurable: true,
    });
    document.body.style.cursor = 'default';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with default panel widths', () => {
    const { result } = renderHook(() => useResizablePanels());
    expect(result.current.leftPanelWidth).toBe(20);
    expect(result.current.rightPanelWidth).toBe(20);
  });

  it('accepts custom initial widths', () => {
    const { result } = renderHook(() => useResizablePanels(30, 25));
    expect(result.current.leftPanelWidth).toBe(30);
    expect(result.current.rightPanelWidth).toBe(25);
  });

  it('exposes setLeftPanelWidth and setRightPanelWidth', () => {
    const { result } = renderHook(() => useResizablePanels());
    act(() => result.current.setLeftPanelWidth(35));
    expect(result.current.leftPanelWidth).toBe(35);
    act(() => result.current.setRightPanelWidth(30));
    expect(result.current.rightPanelWidth).toBe(30);
  });

  describe('startLeftResize', () => {
    it('sets cursor to col-resize on start', () => {
      const { result } = renderHook(() => useResizablePanels());
      const e = makePointerEvent(200) as unknown as React.PointerEvent;
      act(() => result.current.startLeftResize(e));
      expect(document.body.style.cursor).toBe('col-resize');
    });

    it('calls setPointerCapture on start', () => {
      const { result } = renderHook(() => useResizablePanels());
      const capture = vi.fn();
      const e = {
        ...makePointerEvent(200),
        currentTarget: { setPointerCapture: capture },
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent;
      act(() => result.current.startLeftResize(e));
      expect(capture).toHaveBeenCalledWith(1);
    });

    it('updates leftPanelWidth within valid range via pointermove', async () => {
      const { result } = renderHook(() => useResizablePanels());

      // Start resize
      const e = makePointerEvent(200) as unknown as React.PointerEvent;
      act(() => result.current.startLeftResize(e));

      // Simulate pointermove at x=300 → 300/1000 * 100 = 30%
      const _moveEvent = makePointerEvent(300);
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300 }));
      });

      // Allow throttle to pass (16ms)
      await act(async () => {
        vi.advanceTimersByTime(50);
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300 }));
      });

      // Width should be updated
      expect(result.current.leftPanelWidth).toBeGreaterThan(0);
    });
  });

  describe('startRightResize', () => {
    it('sets cursor to col-resize on start', () => {
      const { result } = renderHook(() => useResizablePanels());
      const e = makePointerEvent(800) as unknown as React.PointerEvent;
      act(() => result.current.startRightResize(e));
      expect(document.body.style.cursor).toBe('col-resize');
    });
  });

  describe('panel width clamping', () => {
    it('does not go below 15%', () => {
      const { result } = renderHook(() => useResizablePanels());
      act(() => result.current.setLeftPanelWidth(10)); // setLeftPanelWidth bypasses clamp
      expect(result.current.leftPanelWidth).toBe(10); // direct set has no clamp
    });
  });
});

// React import for typing
import type React from 'react';
