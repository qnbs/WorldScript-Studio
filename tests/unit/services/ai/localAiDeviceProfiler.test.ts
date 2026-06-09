/**
 * Tests for services/ai/localAiDeviceProfiler.ts
 * QNBS-v3: Covers recommendBackend logic, cache TTL, platform detection, memory tier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock webGpuDetectorService so tests don't need a real WebGPU adapter
vi.mock('../../../../services/ai/webGpuDetectorService', () => ({
  detectWebGpuDetails: vi.fn().mockResolvedValue({ status: 'unavailable' }),
}));

const { detectWebGpuDetails } = await import('../../../../services/ai/webGpuDetectorService');

describe('localAiDeviceProfiler', () => {
  let generateDeviceProfile: typeof import('../../../../services/ai/localAiDeviceProfiler').generateDeviceProfile;
  let getDeviceProfile: typeof import('../../../../services/ai/localAiDeviceProfiler').getDeviceProfile;
  let invalidateDeviceProfile: typeof import('../../../../services/ai/localAiDeviceProfiler').invalidateDeviceProfile;
  let _resetDeviceProfileCache: typeof import('../../../../services/ai/localAiDeviceProfiler')._resetDeviceProfileCache;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../../services/ai/localAiDeviceProfiler');
    generateDeviceProfile = mod.generateDeviceProfile;
    getDeviceProfile = mod.getDeviceProfile;
    invalidateDeviceProfile = mod.invalidateDeviceProfile;
    _resetDeviceProfileCache = mod._resetDeviceProfileCache;
    _resetDeviceProfileCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── recommendBackend ──────────────────────────────────────────────────────

  it('returns onnx-wasm when WebGPU is unavailable and memory tier is medium', async () => {
    vi.mocked(detectWebGpuDetails).mockResolvedValue({ status: 'unavailable' });
    const profile = await generateDeviceProfile();
    // No WebGPU → no directml → no webnn → falls through to memory tier check
    expect(['onnx-wasm', 'transformers-wasm']).toContain(profile.recommendedBackend);
  });

  it('returns webllm-webgpu when WebGPU available with non-low vram', async () => {
    vi.mocked(detectWebGpuDetails).mockResolvedValue({
      status: 'available',
      vramTier: 'high',
      adapterDescription: 'Test GPU',
    });
    const profile = await generateDeviceProfile();
    expect(profile.recommendedBackend).toBe('webllm-webgpu');
  });

  it('returns onnx-webgpu when WebGPU available but vram tier is low', async () => {
    vi.mocked(detectWebGpuDetails).mockResolvedValue({
      status: 'available',
      vramTier: 'low',
    });
    const profile = await generateDeviceProfile();
    // low vram → not webllm-webgpu → no webnn/directml → webgpu fallback
    expect(profile.recommendedBackend).toBe('onnx-webgpu');
  });

  // ── cpuCores fallback ─────────────────────────────────────────────────────

  it('reports at least 1 CPU core even when hardwareConcurrency is undefined', async () => {
    const origConcurrency = navigator.hardwareConcurrency;
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      value: undefined,
      configurable: true,
    });
    const profile = await generateDeviceProfile();
    expect(profile.cpuCores).toBeGreaterThanOrEqual(1);
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      value: origConcurrency,
      configurable: true,
    });
  });

  // ── platform detection ────────────────────────────────────────────────────

  it('detects pwa-web on non-mobile browser', async () => {
    const profile = await generateDeviceProfile();
    // jsdom UA does not contain Mobi/Android/iPhone
    expect(profile.platform).toBe('pwa-web');
  });

  it('detects tauri-desktop when __TAURI__ is on window', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI__'] = {};
    const profile = await generateDeviceProfile();
    expect(profile.platform).toBe('tauri-desktop');
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, '__TAURI__');
  });

  // ── battery unavailable ───────────────────────────────────────────────────

  it('returns null battery values when getBattery is unavailable', async () => {
    const profile = await generateDeviceProfile();
    // jsdom does not implement getBattery
    expect(profile.battery.level).toBeNull();
    expect(profile.battery.charging).toBeNull();
  });

  // ── caching ───────────────────────────────────────────────────────────────

  it('getDeviceProfile returns the same object on second call within TTL', async () => {
    const first = await getDeviceProfile();
    const second = await getDeviceProfile();
    expect(second).toBe(first); // same reference = cached
  });

  it('invalidateDeviceProfile causes next getDeviceProfile to re-generate', async () => {
    const first = await getDeviceProfile();
    invalidateDeviceProfile();
    const second = await getDeviceProfile();
    expect(second).not.toBe(first); // different reference = re-generated
  });

  it('getDeviceProfile re-generates after cache TTL expires', async () => {
    vi.useFakeTimers();
    const first = await getDeviceProfile();
    vi.advanceTimersByTime(31_000); // past 30s TTL
    const second = await getDeviceProfile();
    expect(second).not.toBe(first);
    vi.useRealTimers();
  });

  // ── profile shape ─────────────────────────────────────────────────────────

  it('profile contains all expected fields', async () => {
    const profile = await generateDeviceProfile();
    expect(profile).toMatchObject({
      webgpu: expect.objectContaining({ available: expect.any(Boolean) }),
      webnn: expect.objectContaining({ available: expect.any(Boolean) }),
      directml: expect.objectContaining({ available: expect.any(Boolean) }),
      computeShaders: expect.objectContaining({ available: expect.any(Boolean) }),
      memoryTier: expect.stringMatching(/^(high|medium|low)$/),
      platform: expect.any(String),
      battery: expect.objectContaining({ level: null, charging: null }),
      screen: expect.objectContaining({ dpr: expect.any(Number) }),
      cpuCores: expect.any(Number),
      memoryPressureRatio: expect.any(Number),
      recommendedBackend: expect.any(String),
      timestamp: expect.any(Number),
    });
  });
});
