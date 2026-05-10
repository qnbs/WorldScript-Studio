import { describe, expect, it } from 'vitest';
import {
  accessibilityPresetDefaults,
  normalizeAccessibilitySettings,
} from '../../features/settings/accessibilitySchema';

describe('accessibilitySchema', () => {
  it('fills defaults for empty input', () => {
    const a = normalizeAccessibilitySettings({});
    expect(a.presetId).toBe('custom');
    expect(a.liveRegionVerbosity).toBe('normal');
    expect(a.comfortableTargets).toBe(false);
    expect(a.focusIndicators).toBe(true);
  });

  it('motor preset enables comfortable targets and large text', () => {
    const a = accessibilityPresetDefaults('motor');
    expect(a.presetId).toBe('motor');
    expect(a.largeText).toBe(true);
    expect(a.comfortableTargets).toBe(true);
    expect(a.focusIndicators).toBe(true);
  });

  it('screen reader preset uses verbose announcements', () => {
    const a = accessibilityPresetDefaults('screenReader');
    expect(a.screenReader).toBe(true);
    expect(a.liveRegionVerbosity).toBe('verbose');
  });
});
