/**
 * Tests for services/ai/creativityTemperature.ts
 * QNBS-v3: Pure mapping — verifies all three creativity levels map to correct temperatures.
 */

import { describe, expect, it } from 'vitest';
import { CREATIVITY_TO_TEMPERATURE } from '../../../services/ai/creativityTemperature';

describe('CREATIVITY_TO_TEMPERATURE', () => {
  it('maps Focused to 0.2', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Focused).toBe(0.2);
  });

  it('maps Balanced to 0.7', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Balanced).toBe(0.7);
  });

  it('maps Imaginative to 1.0', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Imaginative).toBe(1.0);
  });

  it('covers all three creativity levels', () => {
    expect(Object.keys(CREATIVITY_TO_TEMPERATURE).length).toBe(3);
  });
});
