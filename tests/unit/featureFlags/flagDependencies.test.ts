import { describe, expect, it } from 'vitest';
import {
  defaultFeatureFlagsState,
  type FeatureFlagsState,
} from '../../../features/featureFlags/featureFlagsSlice';
import { resolveFlagAvailability } from '../../../features/featureFlags/flagDependencies';

const flagsWith = (overrides: Partial<FeatureFlagsState>): FeatureFlagsState => ({
  ...defaultFeatureFlagsState,
  ...overrides,
});

describe('resolveFlagAvailability', () => {
  it('blocks Voice WASM when Voice Support is off', () => {
    const flags = flagsWith({ enableVoiceSupport: false, enableVoiceWasm: true });
    const result = resolveFlagAvailability('enableVoiceWasm', flags, true);
    expect(result.blockedBy).toContain('enableVoiceSupport');
    expect(result.effectiveEnabled).toBe(false);
  });

  it('unblocks Voice WASM once Voice Support is on', () => {
    const flags = flagsWith({ enableVoiceSupport: true, enableVoiceWasm: true });
    const result = resolveFlagAvailability('enableVoiceWasm', flags, true);
    expect(result.blockedBy).toHaveLength(0);
    expect(result.effectiveEnabled).toBe(true);
  });

  it('blocks Rust Compute when not running on desktop', () => {
    const flags = flagsWith({ enableRustCompute: true });
    const result = resolveFlagAvailability('enableRustCompute', flags, false);
    expect(result.blockedByDesktop).toBe(true);
    expect(result.effectiveEnabled).toBe(false);
  });

  it('enables Rust Compute on desktop when the flag is on', () => {
    const flags = flagsWith({ enableRustCompute: true });
    const result = resolveFlagAvailability('enableRustCompute', flags, true);
    expect(result.blockedByDesktop).toBe(false);
    expect(result.effectiveEnabled).toBe(true);
  });

  it('treats a flag with no prerequisites as available iff it is on', () => {
    const on = resolveFlagAvailability(
      'enableMindMaps',
      flagsWith({ enableMindMaps: true }),
      false,
    );
    expect(on.blockedBy).toHaveLength(0);
    expect(on.blockedByDesktop).toBe(false);
    expect(on.effectiveEnabled).toBe(true);

    const off = resolveFlagAvailability(
      'enableMindMaps',
      flagsWith({ enableMindMaps: false }),
      false,
    );
    expect(off.effectiveEnabled).toBe(false);
  });
});
