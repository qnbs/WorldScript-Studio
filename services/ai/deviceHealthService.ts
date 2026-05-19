// QNBS-v3: Device health profiling — drives automatic model selection and memory-pressure gates.
//          Adapted from CannaGuide-2025 healthService.ts patterns for creative-writing context.

import { detectWebGpuDetails } from './webGpuDetectorService';

export type DeviceClass = 'high-end' | 'mid-range' | 'low-end' | 'unknown';
export type AiTaskType = 'text-gen' | 'embedding' | 'rag';

export interface DeviceHealthReport {
  deviceClass: DeviceClass;
  cpuCores: number;
  heapUsedMb: number;
  heapTotalMb: number;
  memoryPressureRatio: number; // heapUsed / heapTotal, 0–1
  storageQuotaMb: number | null;
  batteryLevel: number | null; // 0–1, null when Battery API unavailable
  gpuVramTier: 'high' | 'medium' | 'low' | 'none';
  isMobile: boolean;
}

// Minimum free storage required before allowing a model download (200 MB)
const MIN_STORAGE_MB = 200;
// Memory pressure thresholds differ by device type
const MEMORY_PRESSURE_MOBILE = 0.8;
const MEMORY_PRESSURE_DESKTOP = 0.9;

function detectIsMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

function classifyDevice(cores: number, gpuVramTier: string, isMobile: boolean): DeviceClass {
  if (isMobile) {
    return cores >= 6 && gpuVramTier === 'high' ? 'mid-range' : 'low-end';
  }
  if (gpuVramTier === 'high' && cores >= 8) return 'high-end';
  if (gpuVramTier === 'medium' || cores >= 4) return 'mid-range';
  return 'low-end';
}

async function getBatteryLevel(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    if (typeof nav.getBattery !== 'function') return null;
    const battery = await nav.getBattery();
    return battery.level;
  } catch {
    return null;
  }
}

async function getStorageQuotaMb(): Promise<number | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { quota } = await navigator.storage.estimate();
    return quota != null ? Math.round(quota / 1_048_576) : null;
  } catch {
    return null;
  }
}

function getMemoryInfo(): { heapUsedMb: number; heapTotalMb: number } {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  };
  if (perf.memory) {
    return {
      heapUsedMb: Math.round(perf.memory.usedJSHeapSize / 1_048_576),
      heapTotalMb: Math.round(perf.memory.totalJSHeapSize / 1_048_576),
    };
  }
  return { heapUsedMb: 0, heapTotalMb: 0 };
}

export async function getHealthReport(): Promise<DeviceHealthReport> {
  const isMobile = detectIsMobile();
  const cpuCores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1;
  const { heapUsedMb, heapTotalMb } = getMemoryInfo();
  const memoryPressureRatio = heapTotalMb > 0 ? heapUsedMb / heapTotalMb : 0;
  const [storageQuotaMb, batteryLevel, gpuInfo] = await Promise.all([
    getStorageQuotaMb(),
    getBatteryLevel(),
    detectWebGpuDetails(),
  ]);
  const gpuVramTier = gpuInfo.status === 'available' ? (gpuInfo.vramTier ?? 'low') : 'none';
  const deviceClass = classifyDevice(cpuCores, gpuVramTier, isMobile);

  return {
    deviceClass,
    cpuCores,
    heapUsedMb,
    heapTotalMb,
    memoryPressureRatio,
    storageQuotaMb,
    batteryLevel,
    gpuVramTier,
    isMobile,
  };
}

export function getDeviceClass(report: DeviceHealthReport): DeviceClass {
  return report.deviceClass;
}

// QNBS-v3: Maps device class + VRAM tier + task type to the best available model ID.
export function getModelRecommendation(task: AiTaskType, report: DeviceHealthReport): string {
  if (task === 'embedding') {
    // all-MiniLM is always the right call for embeddings regardless of device
    return 'Xenova/all-MiniLM-L6-v2';
  }
  if (task === 'rag') {
    // QNBS-v3: SmolLM2-135M replaces DistilGPT-2 — same size, better instruction following (2025).
    return 'HuggingFaceTB/SmolLM2-135M-Instruct';
  }
  // text-gen: pick by VRAM tier — updated to 2025 releases (Phi-4, Gemma 3).
  switch (report.gpuVramTier) {
    case 'high':
      return 'Phi-4-mini-instruct-q4f16_1-MLC';
    case 'medium':
      return 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
    case 'low':
      return 'gemma-3-1b-it-q4f16_1-MLC';
    default:
      // No GPU: use ONNX WASM
      return 'HuggingFaceTB/SmolLM2-135M-Instruct';
  }
}

// QNBS-v3: Returns true when memory pressure exceeds the safe threshold for model loading.
export function isMemoryPressured(report: DeviceHealthReport): boolean {
  const threshold = report.isMobile ? MEMORY_PRESSURE_MOBILE : MEMORY_PRESSURE_DESKTOP;
  return report.memoryPressureRatio > threshold;
}

// QNBS-v3: Returns true when storage quota is below MIN_STORAGE_MB — blocks large model downloads.
export function hasInsufficientStorage(report: DeviceHealthReport): boolean {
  if (report.storageQuotaMb === null) return false; // unknown → optimistic
  return report.storageQuotaMb < MIN_STORAGE_MB;
}
