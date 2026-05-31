/**
 * webnnBridge — WebNN integration for ONNX Runtime Web.
 * QNBS-v3: Detects navigator.ml, creates MLContext, and configures ONNX EP.
 *          On Windows Edge, WebNN GPU context routes to DirectML backend.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebNNDeviceType = 'gpu' | 'cpu' | 'npu';

export interface WebNNContextInfo {
  available: boolean;
  deviceType?: WebNNDeviceType;
  backendName?: string;
  isDirectML?: boolean;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect WebNN support and create an MLContext.
 * QNBS-v3: Tries NPU → GPU → CPU in that order for best performance/power balance.
 */
export async function detectWebNN(): Promise<WebNNContextInfo> {
  if (typeof navigator === 'undefined' || !('ml' in navigator)) {
    return { available: false };
  }

  const nav = navigator as Navigator & {
    ml?: { createContext?: (opts?: { deviceType?: string }) => Promise<unknown> };
  };

  if (typeof nav.ml?.createContext !== 'function') {
    return { available: false };
  }

  // Try NPU first (best efficiency for inference)
  for (const deviceType of ['npu', 'gpu', 'cpu'] as const) {
    try {
      const ctx = await nav.ml.createContext({ deviceType });
      if (ctx) {
        return {
          available: true,
          deviceType,
          backendName: `webnn-${deviceType}`,
          isDirectML: deviceType === 'gpu' && isDirectMLHeuristic(),
        };
      }
    } catch {
      /* Try next device type */
    }
  }

  return { available: false };
}

/**
 * Heuristic: Are we on Windows Edge where WebNN GPU → DirectML?
 * QNBS-v3: DirectML is only available on Edge Chromium on Windows.
 */
function isDirectMLHeuristic(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isWindows = /Windows NT/i.test(ua);
  const isEdge = /Edg\//i.test(ua);
  return isWindows && isEdge;
}

/**
 * Explicit DirectML check for callers that need certainty.
 */
export function isDirectMLAvailable(webnn: WebNNContextInfo): boolean {
  if (!webnn.available) return false;
  if (webnn.deviceType !== 'gpu') return false;
  return isDirectMLHeuristic();
}

// ---------------------------------------------------------------------------
// ONNX EP Configuration
// ---------------------------------------------------------------------------

/**
 * Build ONNX Runtime Web execution provider list with WebNN first.
 * QNBS-v3: Returns ['webnn', 'wasm'] when WebNN is available, else ['wasm'].
 */
export async function buildWebNNExecutionProviders(): Promise<string[]> {
  const webnn = await detectWebNN();
  if (webnn.available) {
    return ['webnn', 'wasm'];
  }
  return ['wasm'];
}

// ---------------------------------------------------------------------------
// Feature Detection
// ---------------------------------------------------------------------------

/**
 * Check if the browser supports WebNN at all (without creating a context).
 * QNBS-v3: Fast sync check for UI state (e.g., grayed-out WebNN toggle).
 */
export function hasWebNNSupport(): boolean {
  return typeof navigator !== 'undefined' && 'ml' in navigator;
}
