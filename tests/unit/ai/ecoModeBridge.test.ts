/**
 * Tests for the eco mode bridge — ecoModeService.setAiModeEco() + battery level auto-eco.
 * QNBS-v3: Verifies that Redux aiMode → 'eco' correctly flows into ecoModeService,
 * and that battery auto-eco back-syncs to Redux via appStoreRef.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ecoModeService } from '../../../services/ai/ecoModeService';

// Reset singleton state after each test to prevent cross-test pollution.
afterEach(() => {
  ecoModeService.setAiModeEco(false);
  // QNBS-v3: Set battery to 100% so auto-eco doesn't fire in subsequent tests.
  ecoModeService._setBatteryLevelForTest(1.0);
});

describe('setAiModeEco(true/false) — direct bridge', () => {
  it('isEcoMode() returns true after setAiModeEco(true)', () => {
    ecoModeService.setAiModeEco(true);
    expect(ecoModeService.isEcoMode()).toBe(true);
  });

  it('isEcoMode() returns false after setAiModeEco(false)', () => {
    ecoModeService.setAiModeEco(true);
    ecoModeService.setAiModeEco(false);
    expect(ecoModeService.isEcoMode()).toBe(false);
  });

  it('setAiModeEco(false) clears explicit mode — reverts to battery auto-detect', () => {
    ecoModeService.setAiModeEco(true);
    // Set battery high so auto-detect says not eco.
    ecoModeService._setBatteryLevelForTest(0.8);
    ecoModeService.setAiModeEco(false);
    expect(ecoModeService.isEcoMode()).toBe(false);
  });
});

describe('battery level auto-eco via _setBatteryLevelForTest()', () => {
  it('isEcoMode() true when battery < 20%', () => {
    ecoModeService.setAiModeEco(false); // ensure no explicit override
    ecoModeService._setBatteryLevelForTest(0.15);
    expect(ecoModeService.isEcoMode()).toBe(true);
  });

  it('isEcoMode() false when battery ≥ 20%', () => {
    ecoModeService.setAiModeEco(false);
    ecoModeService._setBatteryLevelForTest(0.5);
    expect(ecoModeService.isEcoMode()).toBe(false);
  });

  it('explicit eco overrides battery level', () => {
    ecoModeService._setBatteryLevelForTest(0.8); // battery is fine
    ecoModeService.setAiModeEco(true); // but explicit eco set
    expect(ecoModeService.isEcoMode()).toBe(true);
  });
});

describe('isCriticalBattery()', () => {
  it('true when battery < 10%', () => {
    ecoModeService._setBatteryLevelForTest(0.05);
    expect(ecoModeService.isCriticalBattery()).toBe(true);
  });

  it('false when battery ≥ 10%', () => {
    ecoModeService._setBatteryLevelForTest(0.5);
    expect(ecoModeService.isCriticalBattery()).toBe(false);
  });
});

describe('onEcoModeChange() listener', () => {
  it('fires when setAiModeEco(true) changes state', () => {
    const listener = vi.fn();
    const unsub = ecoModeService.onEcoModeChange(listener);

    ecoModeService.setAiModeEco(true);
    expect(listener).toHaveBeenCalledWith(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('fires when setAiModeEco(false) changes state', () => {
    ecoModeService.setAiModeEco(true);
    const listener = vi.fn();
    const unsub = ecoModeService.onEcoModeChange(listener);

    ecoModeService.setAiModeEco(false);
    expect(listener).toHaveBeenCalledWith(false);

    unsub();
  });

  it('does NOT fire when state is unchanged', () => {
    ecoModeService.setAiModeEco(false);
    const listener = vi.fn();
    const unsub = ecoModeService.onEcoModeChange(listener);

    // Calling setAiModeEco(false) again when already false — no state change.
    ecoModeService.setAiModeEco(false);
    expect(listener).not.toHaveBeenCalled();

    unsub();
  });

  it('unsubscribed listener is not called', () => {
    const listener = vi.fn();
    const unsub = ecoModeService.onEcoModeChange(listener);
    unsub();

    ecoModeService.setAiModeEco(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('applyAdaptiveMode() — battery API back-sync to Redux', () => {
  it('dispatches setAiMode("eco") when battery drops below threshold', async () => {
    const mockDispatch = vi.fn();

    // Mock dynamic imports used inside applyAdaptiveMode levelchange handler.
    vi.doMock('../../../app/storeRef', () => ({
      appStoreRef: { current: { dispatch: mockDispatch } },
    }));
    vi.doMock('../../../features/settings/settingsSlice', () => ({
      settingsActions: {
        setAiMode: vi.fn((mode: string) => ({ type: 'settings/setAiMode', payload: mode })),
      },
    }));

    let levelChangeCallback: (() => void) | null = null;
    const mockBattery = {
      level: 0.5,
      addEventListener: vi.fn((_event: string, cb: () => void) => {
        levelChangeCallback = cb;
      }),
    };

    const navMock = navigator as Navigator & {
      getBattery?: () => Promise<typeof mockBattery>;
    };
    const originalGetBattery = navMock.getBattery;
    navMock.getBattery = () => Promise.resolve(mockBattery);

    await ecoModeService.applyAdaptiveMode();

    // Simulate battery drop.
    mockBattery.level = 0.15;
    ecoModeService._setBatteryLevelForTest(0.15);
    if (levelChangeCallback) (levelChangeCallback as () => void)();

    // Allow dynamic imports in the levelchange handler to resolve.
    await new Promise((r) => setTimeout(r, 50));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setAiMode', payload: 'eco' }),
    );

    // Restore.
    if (originalGetBattery !== undefined) {
      navMock.getBattery = originalGetBattery;
    } else {
      delete navMock.getBattery;
    }
    vi.doUnmock('../../../app/storeRef');
    vi.doUnmock('../../../features/settings/settingsSlice');
  });
});
