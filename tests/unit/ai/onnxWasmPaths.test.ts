// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dropRemoteWasmPaths,
  hasRemoteWasmPath,
} from '../../../packages/ai-core/src/onnxWasmPaths';

const ORIGIN = 'https://qnbs.github.io';
const CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
// What transformers.js 4.3.x sets on import (src/backends/onnx.js) when wasmPaths is empty.
const transformersDefault = () => ({
  mjs: `${CDN}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${CDN}ort-wasm-simd-threaded.asyncify.wasm`,
});

describe('hasRemoteWasmPath (#556)', () => {
  it.each([
    ['the transformers CDN object', transformersDefault(), true],
    ['a CDN prefix string', CDN, true],
    ['another origin', { wasm: 'https://example.com/ort.wasm' }, true],
    ['an unparsable absolute URL', 'https://', true],
    ['a same-origin absolute URL', { wasm: `${ORIGIN}/WorldScript-Studio/assets/ort.wasm` }, false],
    ['a root-relative path', { wasm: '/WorldScript-Studio/assets/ort.wasm' }, false],
    ['a blob URL', { mjs: `blob:${ORIGIN}/0b5c`, wasm: '/assets/ort.wasm' }, false],
    ['no paths', undefined, false],
  ])('%s → %s', (_label, paths, remote) => {
    expect(hasRemoteWasmPath(paths, ORIGIN)).toBe(remote);
  });

  it('treats an absolute URL as remote when the page origin is unknown', () => {
    expect(hasRemoteWasmPath(transformersDefault(), undefined)).toBe(true);
  });
});

describe('dropRemoteWasmPaths (#556)', () => {
  it('removes the CDN paths so ONNX Runtime uses its bundled same-origin WASM', () => {
    const wasm: { wasmPaths?: ReturnType<typeof transformersDefault>; proxy: boolean } = {
      wasmPaths: transformersDefault(),
      proxy: false,
    };
    expect(dropRemoteWasmPaths(wasm)).toBe(true);
    expect('wasmPaths' in wasm).toBe(false);
    expect(wasm.proxy).toBe(false);
  });

  it('keeps same-origin paths and tolerates a missing wasm backend', () => {
    const wasm = { wasmPaths: { wasm: '/assets/ort.wasm' } };
    expect(dropRemoteWasmPaths(wasm)).toBe(false);
    expect(wasm.wasmPaths).toEqual({ wasm: '/assets/ort.wasm' });
    expect(dropRemoteWasmPaths(undefined)).toBe(false);
  });
});

describe('vendor-transformers applies the guard on import (#556)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@huggingface/transformers');
  });

  it('leaves no CDN WASM path and keeps the app-owned cache key', async () => {
    const env = {
      cacheKey: 'transformers-cache',
      backends: { onnx: { wasm: { wasmPaths: transformersDefault(), proxy: false } } },
    };
    vi.doMock('@huggingface/transformers', () => ({ env }));
    await import('../../../packages/ai-core/src/vendor-transformers');
    expect(env.cacheKey).toBe('worldscript-transformers-cache');
    expect(env.backends.onnx.wasm).toEqual({ proxy: false });
  });
});
