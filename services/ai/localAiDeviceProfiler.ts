/**
 * localAiDeviceProfiler — Runtime hardware capability detection for adaptive AI backend selection.
 * QNBS-v3: Replaces static heuristics in deviceHealthService with comprehensive runtime profiling.
 *          Detects WebGPU, WebNN, NPU, Compute Shaders, memory tier, battery, and platform.
 */

import { detectWebGpuDetails } from './webGpuDetectorService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComputeBackend =
  | 'webllm-webgpu'
  | 'onnx-webnn'
  | 'onnx-directml'
  | 'onnx-webgpu'
  | 'onnx-wasm'
  | 'transformers-webgpu'
  | 'transformers-wasm'
  | 'heuristic';

export type DevicePlatform =
  | 'pwa-web'
  | 'pwa-mobile'
  | 'tauri-desktop'
  | 'tauri-mobile'
  | 'unknown';

export interface DeviceCapabilityProfile {
  /** WebGPU capability and adapter details. */
  webgpu: {
    available: boolean;
    adapterDescription?: string;
    architecture?: string;
    vramTier?: 'high' | 'medium' | 'low';
    supportsTimestampQuery?: boolean;
    maxComputeWorkgroupSize?: [number, number, number];
    isFallbackAdapter?: boolean;
  };
  /** WebNN / NPU capability. */
  webnn: {
    available: boolean;
    deviceType?: 'gpu' | 'cpu' | 'npu';
    backend?: string;
  };
  /** DirectML via WebNN on Windows Edge. */
  directml: {
    available: boolean;
    reason?: string;
  };
  /** Compute shader support (WGSL). */
  computeShaders: {
    available: boolean;
    workgroupSize?: [number, number, number];
  };
  /** Memory tier classification. */
  memoryTier: 'high' | 'medium' | 'low';
  /** Runtime platform detection. */
  platform: DevicePlatform;
  /** Battery state (null if API unavailable). */
  battery: {
    level: number | null;
    charging: boolean | null;
  };
  /** Screen pixel density and resolution. */
  screen: {
    dpr: number;
    width: number;
    height: number;
  };
  /** CPU core count (hardwareConcurrency). */
  cpuCores: number;
  /** JS heap pressure ratio (0–1). */
  memoryPressureRatio: number;
  /** Recommended backend for the current device + task. */
  recommendedBackend: ComputeBackend;
  /** Profile generation timestamp. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// WebNN Detection
// ---------------------------------------------------------------------------

interface MLContextWithDeviceType {
  deviceType?: 'gpu' | 'cpu' | 'npu';
}

async function detectWebnn(): Promise<DeviceCapabilityProfile['webnn']> {
  if (typeof navigator === 'undefined' || !('ml' in navigator)) {
    return { available: false };
  }

  const nav = navigator as Navigator & {
    ml?: { createContext?: (opts?: unknown) => Promise<unknown> };
  };
  if (typeof nav.ml?.createContext !== 'function') {
    return { available: false };
  }

  try {
    // Try GPU context first
    const gpuCtx = (await nav.ml.createContext({ deviceType: 'gpu' })) as
      | MLContextWithDeviceType
      | undefined;
    if (gpuCtx) {
      return { available: true, deviceType: 'gpu', backend: 'webnn-gpu' };
    }
  } catch {
    /* GPU context failed — try NPU */
  }

  try {
    const npuCtx = (await nav.ml.createContext({ deviceType: 'npu' })) as
      | MLContextWithDeviceType
      | undefined;
    if (npuCtx) {
      return { available: true, deviceType: 'npu', backend: 'webnn-npu' };
    }
  } catch {
    /* NPU context failed — try CPU */
  }

  try {
    const cpuCtx = (await nav.ml.createContext({ deviceType: 'cpu' })) as
      | MLContextWithDeviceType
      | undefined;
    if (cpuCtx) {
      return { available: true, deviceType: 'cpu', backend: 'webnn-cpu' };
    }
  } catch {
    /* CPU context failed */
  }

  return { available: false };
}

// ---------------------------------------------------------------------------
// DirectML Detection (Windows + Edge Chromium)
// ---------------------------------------------------------------------------

function detectDirectML(
  webnn: DeviceCapabilityProfile['webnn'],
): DeviceCapabilityProfile['directml'] {
  if (!webnn.available) {
    return { available: false, reason: 'WebNN not available' };
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isWindows = /Windows NT/i.test(ua);
  const isEdge = /Edg\//i.test(ua);

  if (!isWindows) {
    return { available: false, reason: 'DirectML requires Windows' };
  }

  if (!isEdge) {
    return { available: false, reason: 'DirectML requires Edge Chromium on Windows' };
  }

  // WebNN GPU context on Windows Edge routes to DirectML backend
  if (webnn.deviceType === 'gpu') {
    return { available: true };
  }

  return { available: false, reason: 'WebNN GPU context not available on this device' };
}

// ---------------------------------------------------------------------------
// Memory Tier
// ---------------------------------------------------------------------------

function detectMemoryTier(): DeviceCapabilityProfile['memoryTier'] {
  const deviceMemory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;

  if (deviceMemory !== undefined) {
    if (deviceMemory >= 8) return 'high';
    if (deviceMemory >= 4) return 'medium';
    return 'low';
  }

  // Fallback: JS heap heuristics
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  };
  if (perf.memory?.jsHeapSizeLimit) {
    const limitMB = perf.memory.jsHeapSizeLimit / (1024 * 1024);
    if (limitMB >= 2048) return 'high';
    if (limitMB >= 1024) return 'medium';
    return 'low';
  }

  return 'medium';
}

// ---------------------------------------------------------------------------
// Platform Detection
// ---------------------------------------------------------------------------

function detectPlatform(): DevicePlatform {
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
  const isMobile =
    typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isTauri) {
    return isMobile ? 'tauri-mobile' : 'tauri-desktop';
  }
  return isMobile ? 'pwa-mobile' : 'pwa-web';
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

async function detectBattery(): Promise<DeviceCapabilityProfile['battery']> {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  };
  if (typeof nav.getBattery !== 'function') {
    return { level: null, charging: null };
  }
  try {
    const battery = await nav.getBattery();
    return { level: battery.level, charging: battery.charging };
  } catch {
    return { level: null, charging: null };
  }
}

// ---------------------------------------------------------------------------
// CPU / Memory Pressure
// ---------------------------------------------------------------------------

function detectCpuCores(): number {
  return typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;
}

function detectMemoryPressure(): number {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  };
  if (perf.memory && perf.memory.totalJSHeapSize > 0) {
    return perf.memory.usedJSHeapSize / perf.memory.totalJSHeapSize;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Backend Recommendation
// ---------------------------------------------------------------------------

function recommendBackend(
  profile: Omit<DeviceCapabilityProfile, 'recommendedBackend'>,
): ComputeBackend {
  // Priority order for backend selection:
  // 1. WebLLM WebGPU — fastest for text generation when VRAM available
  // 2. ONNX + WebNN/DirectML — NPU acceleration on supported devices
  // 3. ONNX + WebGPU — general GPU acceleration
  // 4. Transformers.js WebGPU — lightweight GPU tasks
  // 5. ONNX WASM — CPU fallback, always works
  // 6. Transformers.js WASM — CPU fallback
  // 7. Heuristic — last resort

  if (profile.webgpu.available && profile.webgpu.vramTier !== 'low') {
    return 'webllm-webgpu';
  }

  if (profile.directml.available) {
    return 'onnx-directml';
  }

  if (profile.webnn.available && profile.webnn.deviceType === 'npu') {
    return 'onnx-webnn';
  }

  if (profile.webgpu.available) {
    return 'onnx-webgpu';
  }

  if (profile.memoryTier === 'high') {
    return 'transformers-webgpu';
  }

  if (profile.memoryTier === 'medium') {
    return 'onnx-wasm';
  }

  return 'transformers-wasm';
}

// ---------------------------------------------------------------------------
// Main Profiler
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive device capability profile.
 * QNBS-v3: This is the canonical entry point for adaptive AI backend selection.
 *          Call once on app init, then refresh every 30s or on visibilitychange.
 */
export async function generateDeviceProfile(): Promise<DeviceCapabilityProfile> {
  const [webgpuRaw, webnn, battery] = await Promise.all([
    detectWebGpuDetails(),
    detectWebnn(),
    detectBattery(),
  ]);

  // QNBS-v3: Convert WebGpuAdapterInfo (status field) to profile shape (available bool).
  // Use conditional spread to satisfy exactOptionalPropertyTypes — never pass undefined explicitly.
  const webgpu: DeviceCapabilityProfile['webgpu'] = {
    available: webgpuRaw.status === 'available',
    ...(webgpuRaw.adapterDescription !== undefined && {
      adapterDescription: webgpuRaw.adapterDescription,
    }),
    ...(webgpuRaw.architecture !== undefined && { architecture: webgpuRaw.architecture }),
    ...(webgpuRaw.vramTier !== undefined && { vramTier: webgpuRaw.vramTier }),
    ...(webgpuRaw.supportsTimestampQuery !== undefined && {
      supportsTimestampQuery: webgpuRaw.supportsTimestampQuery,
    }),
    ...(webgpuRaw.maxComputeWorkgroupSize !== undefined && {
      maxComputeWorkgroupSize: webgpuRaw.maxComputeWorkgroupSize,
    }),
    ...(webgpuRaw.isFallbackAdapter !== undefined && {
      isFallbackAdapter: webgpuRaw.isFallbackAdapter,
    }),
  };

  const directml = detectDirectML(webnn);
  const memoryTier = detectMemoryTier();
  const platform = detectPlatform();
  const cpuCores = detectCpuCores();
  const memoryPressureRatio = detectMemoryPressure();

  const computeShaders: DeviceCapabilityProfile['computeShaders'] = {
    available: webgpu.available && webgpu.supportsTimestampQuery === true,
    ...(webgpu.maxComputeWorkgroupSize !== undefined && {
      workgroupSize: webgpu.maxComputeWorkgroupSize,
    }),
  };

  const base = {
    webgpu,
    webnn,
    directml,
    computeShaders,
    memoryTier,
    platform,
    battery,
    screen: {
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      width: typeof window !== 'undefined' ? window.screen.width : 0,
      height: typeof window !== 'undefined' ? window.screen.height : 0,
    },
    cpuCores,
    memoryPressureRatio,
    timestamp: Date.now(),
  };

  return {
    ...base,
    recommendedBackend: recommendBackend(base),
  };
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

let cachedProfile: DeviceCapabilityProfile | null = null;
const CACHE_TTL_MS = 30_000;

/**
 * Get the cached device profile, or generate a new one if stale/missing.
 * QNBS-v3: Cache prevents repeated expensive adapter queries on every inference call.
 */
export async function getDeviceProfile(): Promise<DeviceCapabilityProfile> {
  if (cachedProfile && Date.now() - cachedProfile.timestamp < CACHE_TTL_MS) {
    return cachedProfile;
  }
  cachedProfile = await generateDeviceProfile();
  return cachedProfile;
}

/** Invalidate the cached profile (e.g., after visibilitychange or battery event). */
export function invalidateDeviceProfile(): void {
  cachedProfile = null;
}

/** @internal For test isolation — reset cache between tests. */
export function _resetDeviceProfileCache(): void {
  cachedProfile = null;
}
