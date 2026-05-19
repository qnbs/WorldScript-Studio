import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceHealthReport } from '../../services/ai/deviceHealthService';
import {
  getDeviceClass,
  getHealthReport,
  getModelRecommendation,
  hasInsufficientStorage,
  isMemoryPressured,
} from '../../services/ai/deviceHealthService';

// QNBS-v3: Mock webGpuDetectorService so tests run deterministically in jsdom.
vi.mock('../../services/ai/webGpuDetectorService', () => ({
  detectWebGpuDetails: vi.fn().mockResolvedValue({ status: 'unavailable' }),
}));

const baseReport: DeviceHealthReport = {
  deviceClass: 'mid-range',
  cpuCores: 4,
  heapUsedMb: 200,
  heapTotalMb: 512,
  memoryPressureRatio: 200 / 512,
  storageQuotaMb: 5000,
  batteryLevel: 0.8,
  gpuVramTier: 'medium',
  isMobile: false,
};

describe('deviceHealthService', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 4,
      userAgent: 'Mozilla/5.0 (Desktop)',
      storage: undefined,
      getBattery: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getHealthReport', () => {
    it('returns a valid report with device class', async () => {
      const report = await getHealthReport();
      expect(report).toHaveProperty('deviceClass');
      expect(['high-end', 'mid-range', 'low-end', 'unknown']).toContain(report.deviceClass);
      expect(report.cpuCores).toBe(4);
      expect(report.isMobile).toBe(false);
    });

    it('detects mobile device from user agent', async () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 4,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
        storage: undefined,
        getBattery: undefined,
      });
      const report = await getHealthReport();
      expect(report.isMobile).toBe(true);
    });

    it('reports batteryLevel as null when Battery API is absent', async () => {
      const report = await getHealthReport();
      expect(report.batteryLevel).toBeNull();
    });

    it('reports batteryLevel from Battery API when available', async () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 4,
        userAgent: 'Desktop',
        storage: undefined,
        getBattery: vi.fn().mockResolvedValue({ level: 0.65 }),
      });
      const report = await getHealthReport();
      expect(report.batteryLevel).toBeCloseTo(0.65);
    });

    it('reports storageQuotaMb from storage.estimate()', async () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 4,
        userAgent: 'Desktop',
        storage: { estimate: vi.fn().mockResolvedValue({ quota: 10 * 1024 * 1024 * 1024 }) },
        getBattery: undefined,
      });
      const report = await getHealthReport();
      // 10 GiB = 10240 MB
      expect(report.storageQuotaMb).toBe(10240);
    });
  });

  describe('getDeviceClass', () => {
    it('returns the class from the report', () => {
      expect(getDeviceClass({ ...baseReport, deviceClass: 'high-end' })).toBe('high-end');
      expect(getDeviceClass({ ...baseReport, deviceClass: 'low-end' })).toBe('low-end');
    });
  });

  describe('getModelRecommendation', () => {
    it('returns all-MiniLM for embedding tasks regardless of device', () => {
      expect(getModelRecommendation('embedding', baseReport)).toBe('Xenova/all-MiniLM-L6-v2');
      expect(getModelRecommendation('embedding', { ...baseReport, gpuVramTier: 'none' })).toBe(
        'Xenova/all-MiniLM-L6-v2',
      );
    });

    it('returns SmolLM2-135M for RAG tasks (2025 update)', () => {
      expect(getModelRecommendation('rag', baseReport)).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
    });

    it('returns Phi-4-mini for text-gen on high-VRAM GPU (2025 update)', () => {
      const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'high' };
      expect(getModelRecommendation('text-gen', report)).toBe('Phi-4-mini-instruct-q4f16_1-MLC');
    });

    it('returns Llama-3.2-3B for text-gen on medium-VRAM GPU', () => {
      expect(getModelRecommendation('text-gen', baseReport)).toBe(
        'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      );
    });

    it('returns Gemma-3-1B for text-gen on low-VRAM GPU (2025 update)', () => {
      const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'low' };
      expect(getModelRecommendation('text-gen', report)).toBe('gemma-3-1b-it-q4f16_1-MLC');
    });

    it('returns SmolLM2-135M ONNX for text-gen when no GPU (2025 update)', () => {
      const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'none' };
      expect(getModelRecommendation('text-gen', report)).toBe(
        'HuggingFaceTB/SmolLM2-135M-Instruct',
      );
    });
  });

  describe('isMemoryPressured', () => {
    it('returns false when well below threshold', () => {
      const report: DeviceHealthReport = { ...baseReport, memoryPressureRatio: 0.5 };
      expect(isMemoryPressured(report)).toBe(false);
    });

    it('returns true when above desktop threshold (0.9)', () => {
      const report: DeviceHealthReport = {
        ...baseReport,
        memoryPressureRatio: 0.92,
        isMobile: false,
      };
      expect(isMemoryPressured(report)).toBe(true);
    });

    it('uses stricter 0.8 threshold on mobile', () => {
      const report: DeviceHealthReport = {
        ...baseReport,
        memoryPressureRatio: 0.82,
        isMobile: true,
      };
      expect(isMemoryPressured(report)).toBe(true);
    });
  });

  describe('hasInsufficientStorage', () => {
    it('returns false when storage is null (unknown → optimistic)', () => {
      expect(hasInsufficientStorage({ ...baseReport, storageQuotaMb: null })).toBe(false);
    });

    it('returns true when storage < 200 MB', () => {
      expect(hasInsufficientStorage({ ...baseReport, storageQuotaMb: 150 })).toBe(true);
    });

    it('returns false when storage ≥ 200 MB', () => {
      expect(hasInsufficientStorage({ ...baseReport, storageQuotaMb: 500 })).toBe(false);
    });
  });
});
