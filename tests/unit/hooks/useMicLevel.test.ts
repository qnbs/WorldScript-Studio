import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMicLevel } from '../../../hooks/useMicLevel';

describe('useMicLevel', () => {
  it('returns 0 when inactive', () => {
    const { result } = renderHook(() => useMicLevel(false));
    expect(result.current).toBe(0);
  });

  it('returns 0 (does not throw) when Web Audio / getUserMedia are unavailable', () => {
    // QNBS-v3 (CodeAnt): explicitly make both APIs unavailable so this asserts the unsupported path
    // deterministically, rather than relying on jsdom happening to lack them.
    vi.stubGlobal('AudioContext', undefined);
    const orig = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    try {
      const { result } = renderHook(() => useMicLevel(true));
      expect(result.current).toBe(0);
    } finally {
      if (orig) Object.defineProperty(navigator, 'mediaDevices', orig);
      else Reflect.deleteProperty(navigator, 'mediaDevices');
      vi.unstubAllGlobals();
    }
  });

  it('cleans up without error when toggled off and unmounted', () => {
    const { result, rerender, unmount } = renderHook(({ active }) => useMicLevel(active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    expect(result.current).toBe(0);
    expect(() => unmount()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Active metering path — Web Audio + getUserMedia mocked (absent in jsdom).
  // ---------------------------------------------------------------------------
  describe('with Web Audio available', () => {
    let stopTrack: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let getUserMedia: ReturnType<typeof vi.fn>;
    let rafCbs: FrameRequestCallback[];
    let origMediaDevices: PropertyDescriptor | undefined;

    beforeEach(() => {
      stopTrack = vi.fn();
      close = vi.fn();
      // A loud signal (samples ≠ 128) → non-zero RMS.
      const getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(200));
      getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });

      const source = { connect: vi.fn() };
      const analyser = { fftSize: 0, getByteTimeDomainData, connect: vi.fn() };
      class FakeAudioContext {
        createMediaStreamSource = vi.fn(() => source);
        createAnalyser = vi.fn(() => analyser);
        close = close;
      }

      rafCbs = [];
      origMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia },
        configurable: true,
      });
      vi.stubGlobal('AudioContext', FakeAudioContext);
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((cb: FrameRequestCallback) => {
          rafCbs.push(cb);
          return rafCbs.length;
        }),
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
      // QNBS-v3 (CodeAnt): restore the original descriptor, or REMOVE the own property when jsdom had
      // none — setting an own `undefined` would shadow a prototype-provided mediaDevices for the rest
      // of the run. Reflect.deleteProperty avoids the `delete`-operator lint.
      if (origMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', origMediaDevices);
      } else {
        Reflect.deleteProperty(navigator, 'mediaDevices');
      }
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('reports a non-zero level from the mic and tears down on unmount', async () => {
      const { result, unmount } = renderHook(() => useMicLevel(true));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(getUserMedia).toHaveBeenCalled();

      await act(async () => {
        rafCbs[0]?.(0); // run one metering tick
      });
      expect(result.current).toBeGreaterThan(0);

      unmount();
      expect(stopTrack).toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('stops the stream if cancelled before getUserMedia resolves', async () => {
      let resolveStream: (s: unknown) => void = () => {};
      getUserMedia.mockReturnValue(
        new Promise((r) => {
          resolveStream = r;
        }),
      );
      const { unmount } = renderHook(() => useMicLevel(true));
      unmount(); // cancelled = true
      await act(async () => {
        resolveStream({ getTracks: () => [{ stop: stopTrack }] });
        await Promise.resolve();
      });
      expect(stopTrack).toHaveBeenCalled();
    });

    it('stays at 0 when getUserMedia is denied', async () => {
      getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
      const { result } = renderHook(() => useMicLevel(true));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current).toBe(0);
    });
  });
});
