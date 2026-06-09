/**
 * Tests for services/ai/ecoModeService.ts
 * QNBS-v3: Covers battery auto-detection, explicit override, listener lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh module per test to reset singleton state
describe('ecoModeService', () => {
  let ecoModeService: typeof import('../../../../services/ai/ecoModeService').ecoModeService;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../../services/ai/ecoModeService');
    ecoModeService = mod.ecoModeService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isEcoMode() — auto-detect via battery cache', () => {
    it('returns false by default (no battery data)', () => {
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('returns false when battery level ≥ 0.2', () => {
      ecoModeService._setBatteryLevelForTest(0.5);
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('returns true when battery level < 0.2', () => {
      ecoModeService._setBatteryLevelForTest(0.15);
      expect(ecoModeService.isEcoMode()).toBe(true);
    });

    it('returns true at exactly the threshold boundary (0.19)', () => {
      ecoModeService._setBatteryLevelForTest(0.19);
      expect(ecoModeService.isEcoMode()).toBe(true);
    });

    it('returns false at exactly the threshold boundary (0.20)', () => {
      ecoModeService._setBatteryLevelForTest(0.2);
      expect(ecoModeService.isEcoMode()).toBe(false);
    });
  });

  describe('isCriticalBattery()', () => {
    it('returns false by default (no battery data)', () => {
      expect(ecoModeService.isCriticalBattery()).toBe(false);
    });

    it('returns false when battery level >= 0.1', () => {
      ecoModeService._setBatteryLevelForTest(0.15);
      expect(ecoModeService.isCriticalBattery()).toBe(false);
    });

    it('returns true when battery level < 0.1', () => {
      ecoModeService._setBatteryLevelForTest(0.05);
      expect(ecoModeService.isCriticalBattery()).toBe(true);
    });
  });

  describe('setEcoModeExplicit() / clearExplicitEcoMode()', () => {
    it('explicit true overrides auto-detect regardless of battery', () => {
      ecoModeService._setBatteryLevelForTest(0.9); // high battery → auto = false
      ecoModeService.setEcoModeExplicit(true);
      expect(ecoModeService.isEcoMode()).toBe(true);
    });

    it('explicit false overrides auto-detect regardless of battery', () => {
      ecoModeService._setBatteryLevelForTest(0.05); // low battery → auto = true
      ecoModeService.setEcoModeExplicit(false);
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('clearExplicitEcoMode restores auto-detect', () => {
      ecoModeService._setBatteryLevelForTest(0.15); // auto = true
      ecoModeService.setEcoModeExplicit(false); // explicit override
      ecoModeService.clearExplicitEcoMode();
      expect(ecoModeService.isEcoMode()).toBe(true); // back to auto
    });
  });

  describe('onEcoModeChange() listener', () => {
    it('notifies listener when explicit mode changes from false to true', () => {
      const listener = vi.fn();
      ecoModeService.onEcoModeChange(listener);
      ecoModeService.setEcoModeExplicit(true);
      expect(listener).toHaveBeenCalledWith(true);
    });

    it('notifies listener when explicit mode changes from true to false', () => {
      const listener = vi.fn();
      ecoModeService.setEcoModeExplicit(true); // set first so next call is a change
      ecoModeService.onEcoModeChange(listener);
      ecoModeService.setEcoModeExplicit(false);
      expect(listener).toHaveBeenCalledWith(false);
    });

    it('does NOT notify when mode does not actually change', () => {
      const listener = vi.fn();
      ecoModeService.onEcoModeChange(listener);
      ecoModeService.setEcoModeExplicit(false); // no-op: was already false
      expect(listener).not.toHaveBeenCalled();
    });

    it('returned unsubscribe function removes the listener', () => {
      const listener = vi.fn();
      const unsubscribe = ecoModeService.onEcoModeChange(listener);
      unsubscribe();
      ecoModeService.setEcoModeExplicit(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('applyAdaptiveMode()', () => {
    it('does not throw when getBattery is unavailable', async () => {
      // jsdom navigator has no getBattery
      await expect(ecoModeService.applyAdaptiveMode()).resolves.toBeUndefined();
    });

    it('caches battery level and notifies on levelchange', async () => {
      const listeners: Array<() => void> = [];
      const batteryMock = {
        level: 0.8,
        addEventListener: (_: string, cb: () => void) => {
          listeners.push(cb);
        },
      };
      const getBattery = vi.fn().mockResolvedValue(batteryMock);
      Object.defineProperty(navigator, 'getBattery', { value: getBattery, configurable: true });

      await ecoModeService.applyAdaptiveMode();
      expect(ecoModeService.isEcoMode()).toBe(false); // 0.8 → not eco

      // Simulate battery drop
      batteryMock.level = 0.1;
      for (const cb of listeners) cb();
      expect(ecoModeService.isEcoMode()).toBe(true); // 0.1 → eco

      // Cleanup
      Object.defineProperty(navigator, 'getBattery', { value: undefined, configurable: true });
    });
  });
});
