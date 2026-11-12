/**
 * #556: transformers.js points ONNX Runtime at cdn.jsdelivr.net on import, which the CSP blocks
 * (`script-src 'self' 'wasm-unsafe-eval'`, no jsdelivr in `connect-src`). Without that override, ONNX Runtime
 * loads the same-origin WASM that the build emits from the exact onnxruntime-web it bundles.
 */
type WasmPaths = string | { mjs?: string | URL; wasm?: string | URL } | undefined;

function isRemote(value: string, origin: string | undefined): boolean {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (url.protocol === 'blob:' || url.protocol === 'data:') return false;
  return url.origin !== origin;
}

/** True when any configured ONNX Runtime WASM path is an absolute URL on another origin. */
export function hasRemoteWasmPath(
  paths: WasmPaths,
  origin: string | undefined = globalThis.location?.origin,
): boolean {
  if (paths === undefined) return false;
  const values = typeof paths === 'string' ? [paths] : Object.values(paths);
  return values.some((value) => value !== undefined && isRemote(String(value), origin));
}

/** Removes cross-origin WASM paths so ONNX Runtime falls back to its bundled same-origin assets. */
export function dropRemoteWasmPaths(wasm: { wasmPaths?: WasmPaths } | undefined): boolean {
  if (!wasm || !hasRemoteWasmPath(wasm.wasmPaths)) return false;
  Reflect.deleteProperty(wasm, 'wasmPaths');
  return true;
}
