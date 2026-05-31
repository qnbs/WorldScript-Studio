import { describe, expect, it, vi } from 'vitest';
import {
  buildWebNNExecutionProviders,
  detectWebNN,
  hasWebNNSupport,
  isDirectMLAvailable,
} from '../../packages/ai-core/src/webnnBridge';

describe('webnnBridge', () => {
  describe('hasWebNNSupport', () => {
    it('returns false when navigator.ml is missing', () => {
      const originalMl = (navigator as unknown as Record<string, unknown>)['ml'];
      delete (navigator as unknown as Record<string, unknown>)['ml'];
      expect(hasWebNNSupport()).toBe(false);
      if (originalMl !== undefined) {
        (navigator as unknown as Record<string, unknown>)['ml'] = originalMl;
      }
    });
  });

  describe('detectWebNN', () => {
    it('returns unavailable when navigator.ml is missing', async () => {
      const originalMl = (navigator as unknown as Record<string, unknown>)['ml'];
      delete (navigator as unknown as Record<string, unknown>)['ml'];
      const result = await detectWebNN();
      expect(result.available).toBe(false);
      if (originalMl !== undefined) {
        (navigator as unknown as Record<string, unknown>)['ml'] = originalMl;
      }
    });

    it('returns available with deviceType when createContext succeeds', async () => {
      Object.defineProperty(navigator, 'ml', {
        value: {
          createContext: vi.fn().mockImplementation(async (opts?: { deviceType?: string }) => {
            if (opts?.deviceType === 'npu') throw new Error('NPU not available');
            if (opts?.deviceType === 'gpu') return { deviceType: 'gpu' };
            return {};
          }),
        },
        configurable: true,
        writable: true,
      });

      const result = await detectWebNN();
      expect(result.available).toBe(true);
      expect(result.deviceType).toBe('gpu');
    });
  });

  describe('buildWebNNExecutionProviders', () => {
    it('includes webnn when available', async () => {
      Object.defineProperty(navigator, 'ml', {
        value: {
          createContext: vi.fn().mockResolvedValue({}),
        },
        configurable: true,
        writable: true,
      });

      const eps = await buildWebNNExecutionProviders();
      expect(eps).toContain('webnn');
      expect(eps).toContain('wasm');
    });

    it('returns only wasm when webnn unavailable', async () => {
      delete (navigator as unknown as Record<string, unknown>)['ml'];
      const eps = await buildWebNNExecutionProviders();
      expect(eps).toEqual(['wasm']);
    });
  });

  describe('isDirectMLAvailable', () => {
    it('returns true on Windows Edge with GPU WebNN', () => {
      const originalUa = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        configurable: true,
      });

      expect(isDirectMLAvailable({ available: true, deviceType: 'gpu' })).toBe(true);

      Object.defineProperty(navigator, 'userAgent', {
        value: originalUa,
        configurable: true,
      });
    });

    it('returns false when not GPU context', () => {
      expect(isDirectMLAvailable({ available: true, deviceType: 'cpu' })).toBe(false);
    });
  });
});
