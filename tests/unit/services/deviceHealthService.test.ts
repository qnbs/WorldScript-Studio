/**
 * Tests for services/ai/deviceHealthService.ts
 * QNBS-v3: Pure helpers — getDeviceClass, getModelRecommendation, isMemoryPressured, hasInsufficientStorage.
 */

import { describe, expect, it } from 'vitest';
import type { DeviceHealthReport } from '../../../services/ai/deviceHealthService';
import {
  getDeviceClass,
  getModelRecommendation,
  hasInsufficientStorage,
  isMemoryPressured,
} from '../../../services/ai/deviceHealthService';

function makeReport(overrides: Partial<DeviceHealthReport> = {}): DeviceHealthReport {
  return {
    deviceClass: 'mid-range',
    cpuCores: 4,
    heapUsedMb: 200,
    heapTotalMb: 400,
    memoryPressureRatio: 0.5,
    storageQuotaMb: 1000,
    batteryLevel: 0.8,
    gpuVramTier: 'medium',
    isMobile: false,
    ...overrides,
  };
}

describe('getDeviceClass', () => {
  it('returns the deviceClass from the report', () => {
    expect(getDeviceClass(makeReport({ deviceClass: 'high-end' }))).toBe('high-end');
    expect(getDeviceClass(makeReport({ deviceClass: 'low-end' }))).toBe('low-end');
    expect(getDeviceClass(makeReport({ deviceClass: 'unknown' }))).toBe('unknown');
  });
});

describe('getModelRecommendation', () => {
  it('always returns MiniLM for embedding task', () => {
    const report = makeReport({ gpuVramTier: 'high' });
    expect(getModelRecommendation('embedding', report)).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('always returns SmolLM2 for rag task', () => {
    const report = makeReport({ gpuVramTier: 'none' });
    expect(getModelRecommendation('rag', report)).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
  });

  it('returns Phi-4 for text-gen with high VRAM', () => {
    const report = makeReport({ gpuVramTier: 'high' });
    expect(getModelRecommendation('text-gen', report)).toBe('Phi-4-mini-instruct-q4f16_1-MLC');
  });

  it('returns Llama-3.2-3B for text-gen with medium VRAM', () => {
    const report = makeReport({ gpuVramTier: 'medium' });
    expect(getModelRecommendation('text-gen', report)).toBe('Llama-3.2-3B-Instruct-q4f16_1-MLC');
  });

  it('returns Gemma-3 for text-gen with low VRAM', () => {
    const report = makeReport({ gpuVramTier: 'low' });
    expect(getModelRecommendation('text-gen', report)).toBe('gemma-3-1b-it-q4f16_1-MLC');
  });

  it('returns SmolLM2 for text-gen with no GPU', () => {
    const report = makeReport({ gpuVramTier: 'none' });
    expect(getModelRecommendation('text-gen', report)).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
  });
});

describe('isMemoryPressured', () => {
  it('returns false when pressure is below desktop threshold (0.9)', () => {
    const report = makeReport({ memoryPressureRatio: 0.85, isMobile: false });
    expect(isMemoryPressured(report)).toBe(false);
  });

  it('returns true when pressure exceeds desktop threshold', () => {
    const report = makeReport({ memoryPressureRatio: 0.95, isMobile: false });
    expect(isMemoryPressured(report)).toBe(true);
  });

  it('returns false when pressure is below mobile threshold (0.8)', () => {
    const report = makeReport({ memoryPressureRatio: 0.75, isMobile: true });
    expect(isMemoryPressured(report)).toBe(false);
  });

  it('returns true when pressure exceeds mobile threshold', () => {
    const report = makeReport({ memoryPressureRatio: 0.85, isMobile: true });
    expect(isMemoryPressured(report)).toBe(true);
  });
});

describe('hasInsufficientStorage', () => {
  it('returns false when storageQuotaMb is null (unknown = optimistic)', () => {
    const report = makeReport({ storageQuotaMb: null });
    expect(hasInsufficientStorage(report)).toBe(false);
  });

  it('returns true when storage is below 200 MB', () => {
    const report = makeReport({ storageQuotaMb: 100 });
    expect(hasInsufficientStorage(report)).toBe(true);
  });

  it('returns false when storage is exactly 200 MB', () => {
    const report = makeReport({ storageQuotaMb: 200 });
    expect(hasInsufficientStorage(report)).toBe(false);
  });

  it('returns false when storage is well above threshold', () => {
    const report = makeReport({ storageQuotaMb: 5000 });
    expect(hasInsufficientStorage(report)).toBe(false);
  });
});
