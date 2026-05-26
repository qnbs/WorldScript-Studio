/**
 * Tests for services/ai/ecoModeService.ts
 * QNBS-v3: Singleton with test helper _setBatteryLevelForTest — covers explicit mode, auto-detect, listeners.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Re-import fresh instance each time by resetting module registry
// ecoModeService is a singleton — use _setBatteryLevelForTest + clearExplicitEcoMode to reset state

describe('ecoModeService', () => {
  // Import after each reset to get the module's singleton
  let ecoModeService: typeof import('../../services/ai/ecoModeService').ecoModeService;
  let ECO_MODE_MODEL_ID: string;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../services/ai/ecoModeService');
    ecoModeService = mod.ecoModeService;
    ECO_MODE_MODEL_ID = mod.ECO_MODE_MODEL_ID;
    // Reset singleton state between tests
    ecoModeService.clearExplicitEcoMode();
    ecoModeService._setBatteryLevelForTest(null as unknown as number);
  });

  describe('ECO_MODE_MODEL_ID constant', () => {
    it('is SmolLM2-135M', () => {
      expect(ECO_MODE_MODEL_ID).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
    });
  });

  describe('setEcoModeExplicit / isEcoMode', () => {
    it('returns false by default', () => {
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('returns true after setEcoModeExplicit(true)', () => {
      ecoModeService.setEcoModeExplicit(true);
      expect(ecoModeService.isEcoMode()).toBe(true);
    });

    it('returns false after setEcoModeExplicit(false)', () => {
      ecoModeService.setEcoModeExplicit(true);
      ecoModeService.setEcoModeExplicit(false);
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('returns false after clearExplicitEcoMode when battery is normal', () => {
      ecoModeService.setEcoModeExplicit(true);
      ecoModeService._setBatteryLevelForTest(0.9);
      ecoModeService.clearExplicitEcoMode();
      expect(ecoModeService.isEcoMode()).toBe(false);
    });
  });

  describe('auto-detect via battery level', () => {
    it('returns true when battery < 0.2 (auto mode)', () => {
      ecoModeService._setBatteryLevelForTest(0.15);
      expect(ecoModeService.isEcoMode()).toBe(true);
    });

    it('returns false when battery >= 0.2', () => {
      ecoModeService._setBatteryLevelForTest(0.5);
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('returns false when battery is exactly 0.2', () => {
      ecoModeService._setBatteryLevelForTest(0.2);
      expect(ecoModeService.isEcoMode()).toBe(false);
    });

    it('explicit mode overrides battery level', () => {
      ecoModeService._setBatteryLevelForTest(0.05); // would be eco
      ecoModeService.setEcoModeExplicit(false); // explicit override
      expect(ecoModeService.isEcoMode()).toBe(false);
    });
  });

  describe('isCriticalBattery', () => {
    it('returns false when no battery level set', () => {
      expect(ecoModeService.isCriticalBattery()).toBe(false);
    });

    it('returns true when battery < 0.1', () => {
      ecoModeService._setBatteryLevelForTest(0.05);
      expect(ecoModeService.isCriticalBattery()).toBe(true);
    });

    it('returns false when battery >= 0.1', () => {
      ecoModeService._setBatteryLevelForTest(0.1);
      expect(ecoModeService.isCriticalBattery()).toBe(false);
    });

    it('returns false when battery is 0.5', () => {
      ecoModeService._setBatteryLevelForTest(0.5);
      expect(ecoModeService.isCriticalBattery()).toBe(false);
    });
  });

  describe('onEcoModeChange listener', () => {
    it('calls listener when eco mode changes via explicit set', () => {
      const listener = vi.fn();
      ecoModeService.onEcoModeChange(listener);

      ecoModeService.setEcoModeExplicit(true);
      expect(listener).toHaveBeenCalledWith(true);
    });

    it('calls listener when eco mode is cleared and battery is normal', () => {
      ecoModeService.setEcoModeExplicit(true);
      const listener = vi.fn();
      ecoModeService.onEcoModeChange(listener);
      ecoModeService._setBatteryLevelForTest(0.9);

      ecoModeService.clearExplicitEcoMode();
      expect(listener).toHaveBeenCalledWith(false);
    });

    it('does not call listener when eco mode does not change', () => {
      const listener = vi.fn();
      ecoModeService.onEcoModeChange(listener);
      // Already false → setEcoModeExplicit(false) should not notify
      ecoModeService.setEcoModeExplicit(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function that removes the listener', () => {
      const listener = vi.fn();
      const unsubscribe = ecoModeService.onEcoModeChange(listener);
      unsubscribe();

      ecoModeService.setEcoModeExplicit(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('applyAdaptiveMode', () => {
    it('does nothing when navigator.getBattery is unavailable', async () => {
      const origNav = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { getBattery: undefined },
        writable: true,
        configurable: true,
      });
      await expect(ecoModeService.applyAdaptiveMode()).resolves.toBeUndefined();
      Object.defineProperty(global, 'navigator', {
        value: origNav,
        writable: true,
        configurable: true,
      });
    });
  });
});
