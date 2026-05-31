// QNBS-v3: Standalone GPU capability probe — decoupled from ai-core so UI can display status
//          without triggering a heavy inference load.

export type WebGpuStatus = 'available' | 'unavailable' | 'unknown';

export interface WebGpuAdapterInfo {
  status: WebGpuStatus;
  adapterDescription?: string;
  architecture?: string;
  vramTier?: 'high' | 'medium' | 'low';
  // QNBS-v3: Extended capability detection for compute shader and performance tuning.
  powerPreference?: 'low-power' | 'high-performance';
  supportsTimestampQuery?: boolean;
  maxComputeWorkgroupSize?: [number, number, number];
  isFallbackAdapter?: boolean;
}

// 8 GiB / 4 GiB thresholds for maxBufferSize heuristic
const VRAM_HIGH_BYTES = 8 * 1024 * 1024 * 1024;
const VRAM_MED_BYTES = 4 * 1024 * 1024 * 1024;

function classifyVram(maxBufferSize: number): 'high' | 'medium' | 'low' {
  if (maxBufferSize >= VRAM_HIGH_BYTES) return 'high';
  if (maxBufferSize >= VRAM_MED_BYTES) return 'medium';
  return 'low';
}

export async function detectWebGpuDetails(
  opts: { powerPreference?: 'low-power' | 'high-performance'; forceFallbackAdapter?: boolean } = {},
): Promise<WebGpuAdapterInfo> {
  if (!('gpu' in navigator)) {
    return { status: 'unavailable' };
  }

  let adapter: GPUAdapter | null = null;
  try {
    // QNBS-v3: cast options to avoid exactOptionalPropertyTypes overload mismatch
    const adapterOpts: GPURequestAdapterOptions = {};
    if (opts.powerPreference !== undefined) adapterOpts.powerPreference = opts.powerPreference;
    if (opts.forceFallbackAdapter !== undefined)
      adapterOpts.forceFallbackAdapter = opts.forceFallbackAdapter;
    adapter = await (navigator.gpu as GPU).requestAdapter(adapterOpts);
  } catch {
    return { status: 'unknown' };
  }

  if (!adapter) {
    return { status: 'unknown' };
  }

  // QNBS-v3: exactOptionalPropertyTypes — only include powerPreference when caller specified it
  const info: WebGpuAdapterInfo = {
    status: 'available',
    vramTier: classifyVram(adapter.limits.maxBufferSize),
    isFallbackAdapter: opts.forceFallbackAdapter ?? false,
    ...(opts.powerPreference !== undefined && { powerPreference: opts.powerPreference }),
  };

  // QNBS-v3: Feature detection for compute shader support.
  try {
    const features = adapter.features as Set<string> | undefined;
    if (features) {
      info.supportsTimestampQuery = features.has('timestamp-query');
    }
    const limits = adapter.limits as {
      maxComputeWorkgroupSizeX?: number;
      maxComputeWorkgroupSizeY?: number;
      maxComputeWorkgroupSizeZ?: number;
    };
    if (
      limits.maxComputeWorkgroupSizeX !== undefined &&
      limits.maxComputeWorkgroupSizeY !== undefined &&
      limits.maxComputeWorkgroupSizeZ !== undefined
    ) {
      info.maxComputeWorkgroupSize = [
        limits.maxComputeWorkgroupSizeX,
        limits.maxComputeWorkgroupSizeY,
        limits.maxComputeWorkgroupSizeZ,
      ];
    }
  } catch {
    // limits/features may not be fully implemented — not an error
  }

  // requestAdapterInfo() is experimental — not present in all browsers
  try {
    const adapterInfo = await (
      adapter as GPUAdapter & {
        requestAdapterInfo?: () => Promise<{
          vendor?: string;
          architecture?: string;
          description?: string;
        }>;
      }
    ).requestAdapterInfo?.();
    if (adapterInfo) {
      if (adapterInfo.description) info.adapterDescription = adapterInfo.description;
      if (adapterInfo.architecture) info.architecture = adapterInfo.architecture;
    }
  } catch {
    // experimental API absent — not an error
  }

  return info;
}
