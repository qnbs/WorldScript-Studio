// QNBS-v3: Eco mode — auto-detects low battery / low-end device and forces lightweight inference.
//          Adapted from CannaGuide-2025 ecoModeService.ts for StoryCraft context.

const LOW_BATTERY_THRESHOLD = 0.2; // < 20% → eco mode
const CRITICAL_BATTERY_THRESHOLD = 0.1; // < 10% → critical (block large downloads)

// QNBS-v3: SmolLM2-135M is the 2025 eco-mode standard — 135M params, 270MB ONNX WASM footprint.
export const ECO_MODE_MODEL_ID = 'HuggingFaceTB/SmolLM2-135M-Instruct';

type EcoModeListener = (active: boolean) => void;

class EcoModeService {
  private explicitEcoMode: boolean | null = null; // null = auto-detect
  private listeners: Set<EcoModeListener> = new Set();
  private cachedBatteryLevel: number | null = null;

  private notify(active: boolean): void {
    for (const listener of this.listeners) listener(active);
  }

  setEcoModeExplicit(active: boolean): void {
    const prev = this.isEcoMode();
    this.explicitEcoMode = active;
    if (this.isEcoMode() !== prev) this.notify(this.isEcoMode());
  }

  clearExplicitEcoMode(): void {
    const prev = this.isEcoMode();
    this.explicitEcoMode = null;
    if (this.isEcoMode() !== prev) this.notify(this.isEcoMode());
  }

  isEcoMode(): boolean {
    if (this.explicitEcoMode !== null) return this.explicitEcoMode;
    // Auto: eco when battery is low
    if (this.cachedBatteryLevel !== null && this.cachedBatteryLevel < LOW_BATTERY_THRESHOLD) {
      return true;
    }
    return false;
  }

  isCriticalBattery(): boolean {
    return this.cachedBatteryLevel !== null && this.cachedBatteryLevel < CRITICAL_BATTERY_THRESHOLD;
  }

  // QNBS-v3: Reads Battery API and sets mode; call once on app init.
  async applyAdaptiveMode(): Promise<void> {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        addEventListener: (e: string, cb: () => void) => void;
      }>;
    };
    if (typeof nav.getBattery !== 'function') return;

    try {
      const battery = await nav.getBattery();
      this.cachedBatteryLevel = battery.level;
      battery.addEventListener('levelchange', () => {
        this.cachedBatteryLevel = battery.level;
        this.notify(this.isEcoMode());
      });
    } catch {
      // Battery API unavailable — stay in auto mode (not eco by default)
    }
  }

  onEcoModeChange(listener: EcoModeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // QNBS-v3: Used by tests to inject a battery level without the real Battery API.
  _setBatteryLevelForTest(level: number): void {
    this.cachedBatteryLevel = level;
  }
}

export const ecoModeService = new EcoModeService();
