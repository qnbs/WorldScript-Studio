import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock WebGPU globals for jsdom
if (typeof GPUShaderStage === 'undefined') {
  Object.defineProperty(globalThis, 'GPUShaderStage', {
    value: { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 },
    writable: true,
    configurable: true,
  });
}
if (typeof GPUBufferUsage === 'undefined') {
  Object.defineProperty(globalThis, 'GPUBufferUsage', {
    value: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64 },
    writable: true,
    configurable: true,
  });
}

import {
  clearShaderCache,
  createAttentionBuffers,
  createAttentionPipeline,
  createComputePipeline,
  createKvCachePipeline,
  createMlpPipeline,
  createSimilarityBuffers,
  createSimilarityPipeline,
  encodeAttentionUniforms,
  encodeSimilarityUniforms,
  getComputeDevice,
  loadShader,
  releaseComputeDevice,
} from '../../../../services/ai/computeShaderFactory';

// Minimal GPU mocks
function createFakeDevice() {
  return {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
    destroy: vi.fn(),
    // QNBS-v3: never-resolving promise avoids clearing cachedDevice during the test
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
  } as unknown as GPUDevice;
}

function createFakeAdapter() {
  return {
    requestDevice: vi.fn(async () => createFakeDevice()),
  } as unknown as GPUAdapter;
}

beforeEach(() => {
  clearShaderCache(); // no-op with ?raw, but kept for API compat
  releaseComputeDevice();
});

afterEach(() => {
  releaseComputeDevice();
});

describe('loadShader', () => {
  it('returns bundled WGSL string for known shader names', async () => {
    // QNBS-v3: With ?raw imports, loadShader returns actual WGSL content at test time
    const wgsl = await loadShader('textProcessing');
    expect(typeof wgsl).toBe('string');
    expect(wgsl.length).toBeGreaterThan(0);
    // Should contain real shader functions from textProcessing.wgsl
    expect(wgsl).toContain('batchCosineSimilarity');
  });

  it('returns correct source for each shader name', async () => {
    const shaders = ['textProcessing', 'attention', 'feedForward', 'kvCache'];
    for (const name of shaders) {
      const src = await loadShader(name);
      expect(src.length, `shader ${name} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('is idempotent — multiple calls return same content', async () => {
    const first = await loadShader('feedForward');
    const second = await loadShader('feedForward');
    expect(first).toBe(second);
  });

  it('throws for unknown shader names', async () => {
    await expect(loadShader('nonexistent')).rejects.toThrow('Unknown shader');
  });
});

describe('getComputeDevice', () => {
  it('returns null when navigator.gpu is missing', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });
    const dev = await getComputeDevice();
    expect(dev).toBeNull();
  });

  it('returns cached device on second call', async () => {
    releaseComputeDevice(); // ensure clean slate
    const fakeDevice = createFakeDevice();
    const fakeAdapter = createFakeAdapter();
    fakeAdapter.requestDevice = vi.fn(async () => fakeDevice);

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter: vi.fn(async () => fakeAdapter),
        },
      },
      writable: true,
      configurable: true,
    });

    const dev1 = await getComputeDevice();
    expect(dev1).toBe(fakeDevice);
    const dev2 = await getComputeDevice();
    expect(dev2).toBe(fakeDevice);
    expect(navigator.gpu.requestAdapter).toHaveBeenCalledTimes(1);
  });
});

describe('createComputePipeline', () => {
  it('creates a pipeline using bundled WGSL source', async () => {
    const device = createFakeDevice();

    const pipeline = await createComputePipeline(
      device,
      'textProcessing',
      'batchCosineSimilarity',
      [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }],
    );

    expect(pipeline.device).toBe(device);
    expect(pipeline.label).toBe('textProcessing:batchCosineSimilarity');
    expect(device.createShaderModule).toHaveBeenCalled();
    expect(device.createComputePipeline).toHaveBeenCalled();
  });
});

describe('createSimilarityPipeline', () => {
  it('creates a RAG similarity pipeline with correct label', async () => {
    const device = createFakeDevice();
    const pipeline = await createSimilarityPipeline(device);
    expect(pipeline.label).toBe('rag-similarity');
    expect(device.createShaderModule).toHaveBeenCalled();
  });

  it('creates similarity buffers with correct count', () => {
    const device = createFakeDevice();
    const buffers = createSimilarityBuffers(device, 4, 128);
    expect(device.createBuffer).toHaveBeenCalledTimes(4);
    expect(buffers).toHaveProperty('queryBuffer');
    expect(buffers).toHaveProperty('outBuffer');
  });

  it('encodes similarity uniforms via writeBuffer', () => {
    const device = createFakeDevice();
    const buffer = device.createBuffer({ size: 8, usage: 0 });
    encodeSimilarityUniforms(device, buffer as GPUBuffer, 4, 128);
    expect(device.queue.writeBuffer).toHaveBeenCalled();
  });
});

describe('createAttentionPipeline', () => {
  it('creates an attention pipeline with correct label', async () => {
    const device = createFakeDevice();
    const pipeline = await createAttentionPipeline(device);
    expect(pipeline.label).toBe('attention-serial');
  });

  it('creates attention buffers — 5 buffers (Q, K, V, out, uniform)', () => {
    const device = createFakeDevice();
    const buffers = createAttentionBuffers(device, 16, 64);
    expect(device.createBuffer).toHaveBeenCalledTimes(5);
    expect(buffers).toHaveProperty('qBuffer');
    expect(buffers).toHaveProperty('outBuffer');
  });

  it('encodes attention uniforms via 2 writeBuffer calls (u32 pair + f32 scale)', () => {
    const device = createFakeDevice();
    const buffer = device.createBuffer({ size: 12, usage: 0 });
    encodeAttentionUniforms(device, buffer as GPUBuffer, 16, 64, 0.125);
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(2);
  });
});

describe('createMlpPipeline', () => {
  it('creates an MLP feed-forward pipeline', async () => {
    const device = createFakeDevice();
    const pipeline = await createMlpPipeline(device);
    expect(pipeline.label).toBe('mlp-forward');
  });
});

describe('createKvCachePipeline', () => {
  it('creates a KV-cache append pipeline', async () => {
    const device = createFakeDevice();
    const pipeline = await createKvCachePipeline(device);
    expect(pipeline.label).toBe('kv-cache-append');
  });
});
