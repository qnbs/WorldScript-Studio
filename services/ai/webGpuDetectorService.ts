// QNBS-v3: Standalone GPU capability probe — decoupled from ai-core so UI can display status
//          without triggering a heavy inference load.

export type WebGpuStatus = 'available' | 'unavailable' | 'unknown';

export interface WebGpuAdapterInfo {
  status: WebGpuStatus;
  adapterDescription?: string;
  architecture?: string;
  vramTier?: 'high' | 'medium' | 'low';
}

// 8 GiB / 4 GiB thresholds for maxBufferSize heuristic
const VRAM_HIGH_BYTES = 8 * 1024 * 1024 * 1024;
const VRAM_MED_BYTES = 4 * 1024 * 1024 * 1024;

function classifyVram(maxBufferSize: number): 'high' | 'medium' | 'low' {
  if (maxBufferSize >= VRAM_HIGH_BYTES) return 'high';
  if (maxBufferSize >= VRAM_MED_BYTES) return 'medium';
  return 'low';
}

export async function detectWebGpuDetails(): Promise<WebGpuAdapterInfo> {
  if (!('gpu' in navigator)) {
    return { status: 'unavailable' };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await (navigator.gpu as GPU).requestAdapter();
  } catch {
    return { status: 'unknown' };
  }

  if (!adapter) {
    return { status: 'unknown' };
  }

  const info: WebGpuAdapterInfo = {
    status: 'available',
    vramTier: classifyVram(adapter.limits.maxBufferSize),
  };

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
