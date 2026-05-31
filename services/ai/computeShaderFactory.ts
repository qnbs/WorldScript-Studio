/**
 * computeShaderFactory.ts — WebGPU Compute Shader orchestration for Edge-AI acceleration.
 * QNBS-v3: WGSL sources are bundled inline via Vite ?raw imports — no fetch() at runtime,
 * so pipelines work identically in dev, production, and edge/SSR builds.
 */

// QNBS-v3: Use logger singleton (not createLogger) so tests that mock services/logger
//          don't need to also mock createLogger for transitive callers.
import { logger } from '../logger';
import attentionWgslSrc from './shaders/attention.wgsl?raw';
import feedForwardWgslSrc from './shaders/feedForward.wgsl?raw';
import kvCacheWgslSrc from './shaders/kvCache.wgsl?raw';
// QNBS-v3: ?raw imports bundle WGSL as strings at build time — no runtime fetch needed
import textProcessingWgslSrc from './shaders/textProcessing.wgsl?raw';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ComputePipeline {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
  label: string;
}

export interface ShaderModuleSource {
  name: string;
  wgsl: string;
}

export interface SimilarityBuffers {
  queryBuffer: GPUBuffer;
  docBuffer: GPUBuffer;
  outBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
}

export interface AttentionBuffers {
  qBuffer: GPUBuffer;
  kBuffer: GPUBuffer;
  vBuffer: GPUBuffer;
  outBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
}

// ------------------------------------------------------------------
// Shader sources — bundled inline at build time via ?raw imports
// ------------------------------------------------------------------

// QNBS-v3: Static map of bundled WGSL strings; no network fetch at runtime
const SHADER_SOURCES: Readonly<Record<string, string>> = {
  textProcessing: textProcessingWgslSrc,
  attention: attentionWgslSrc,
  feedForward: feedForwardWgslSrc,
  kvCache: kvCacheWgslSrc,
};

/** Return a bundled WGSL shader string synchronously (async signature retained for API compat). */
export async function loadShader(name: string): Promise<string> {
  const src = SHADER_SOURCES[name];
  if (src === undefined) {
    throw new Error(`Unknown shader: ${name}`);
  }
  return src;
}

/** No-op — kept for API compatibility; ?raw imports have no runtime cache to clear. */
export function clearShaderCache(): void {
  // no-op: sources are compile-time constants
}

// ------------------------------------------------------------------
// Device acquisition
// ------------------------------------------------------------------

let cachedDevice: GPUDevice | null = null;
// QNBS-v3: in-flight promise prevents concurrent requestDevice() calls when two callers
//          race on a null cachedDevice — without this guard both create separate GPU devices
let deviceInitPromise: Promise<GPUDevice | null> | null = null;

export async function getComputeDevice(): Promise<GPUDevice | null> {
  if (cachedDevice) {
    return cachedDevice;
  }

  // QNBS-v3: serialise concurrent init requests; second caller awaits the first
  if (deviceInitPromise) {
    return deviceInitPromise;
  }

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return null;
  }

  deviceInitPromise = (async () => {
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) return null;

      const device = await adapter.requestDevice();
      if (!device) return null;

      device.lost.then((info) => {
        logger.warn('WebGPU device lost', { reason: info.reason, message: info.message });
        cachedDevice = null;
        deviceInitPromise = null;
      });

      cachedDevice = device;
      return device;
    } catch (err) {
      logger.warn('WebGPU device acquisition failed', err as Error);
      return null;
    } finally {
      deviceInitPromise = null;
    }
  })();

  return deviceInitPromise;
}

export function releaseComputeDevice(): void {
  if (cachedDevice) {
    cachedDevice.destroy();
    cachedDevice = null;
  }
  // QNBS-v3: reset in-flight promise so next caller re-creates a fresh device
  deviceInitPromise = null;
}

// ------------------------------------------------------------------
// Pipeline factory
// ------------------------------------------------------------------

export async function createComputePipeline(
  device: GPUDevice,
  shaderName: string,
  entryPoint: string,
  bindGroupEntries: GPUBindGroupLayoutEntry[],
  label?: string,
): Promise<ComputePipeline> {
  const wgsl = await loadShader(shaderName);
  const module = device.createShaderModule({
    code: wgsl,
    label: `${shaderName}:${entryPoint}`,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: bindGroupEntries,
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint },
    label: label ?? `${shaderName}:${entryPoint}`,
  });

  return { device, pipeline, bindGroupLayout, label: label ?? `${shaderName}:${entryPoint}` };
}

// ------------------------------------------------------------------
// High-level helpers: RAG batch cosine similarity
// ------------------------------------------------------------------

export async function createSimilarityPipeline(device: GPUDevice): Promise<ComputePipeline> {
  return createComputePipeline(
    device,
    'textProcessing',
    'batchCosineSimilarity',
    [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
    'rag-similarity',
  );
}

export function createSimilarityBuffers(
  device: GPUDevice,
  numDocuments: number,
  vectorDim: number,
): SimilarityBuffers {
  const queryBuffer = device.createBuffer({
    size: vectorDim * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const docBuffer = device.createBuffer({
    size: numDocuments * vectorDim * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outBuffer = device.createBuffer({
    size: numDocuments * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const uniformBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return { queryBuffer, docBuffer, outBuffer, uniformBuffer };
}

export function encodeSimilarityUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  numDocuments: number,
  vectorDim: number,
): void {
  const arr = new Uint32Array([numDocuments, vectorDim]);
  device.queue.writeBuffer(buffer, 0, arr);
}

// ------------------------------------------------------------------
// High-level helpers: Attention
// ------------------------------------------------------------------

export async function createAttentionPipeline(device: GPUDevice): Promise<ComputePipeline> {
  return createComputePipeline(
    device,
    'attention',
    'attentionForwardSerial',
    [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
    'attention-serial',
  );
}

export function createAttentionBuffers(
  device: GPUDevice,
  seqLen: number,
  headDim: number,
): AttentionBuffers {
  const bytes = seqLen * headDim * 4;
  const qBuffer = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const kBuffer = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const vBuffer = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outBuffer = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const uniformBuffer = device.createBuffer({
    size: 12,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return { qBuffer, kBuffer, vBuffer, outBuffer, uniformBuffer };
}

export function encodeAttentionUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  seqLen: number,
  headDim: number,
  scale: number,
): void {
  const arr = new Uint32Array([seqLen, headDim]);
  const fArr = new Float32Array([scale]);
  device.queue.writeBuffer(buffer, 0, arr);
  device.queue.writeBuffer(buffer, 8, fArr);
}

// ------------------------------------------------------------------
// High-level helpers: Feed-forward
// ------------------------------------------------------------------

/**
 * Create the MLP forward-pass compute pipeline.
 * NOTE: feedForward.wgsl uses a stack array capped at 4096 units.
 * Always use encodeMlpUniforms() which clamps intermediateSize to MAX_MLP_INTERMEDIATE.
 */
export async function createMlpPipeline(device: GPUDevice): Promise<ComputePipeline> {
  return createComputePipeline(
    device,
    'feedForward',
    'mlpForward',
    [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
    'mlp-forward',
  );
}

// QNBS-v3: feedForward.wgsl uses var<workgroup> array<f32, 4096> — hard limit
const MAX_MLP_INTERMEDIATE = 4096;

export function encodeMlpUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  batchSize: number,
  seqLen: number,
  hiddenSize: number,
  intermediateSize: number,
): void {
  if (intermediateSize > MAX_MLP_INTERMEDIATE) {
    logger.warn('encodeMlpUniforms: intermediateSize exceeds 4096, clamping', { intermediateSize });
  }
  const safeIntermSize = Math.min(intermediateSize, MAX_MLP_INTERMEDIATE);
  const arr = new Uint32Array([batchSize, seqLen, hiddenSize, safeIntermSize]);
  device.queue.writeBuffer(buffer, 0, arr);
}

// ------------------------------------------------------------------
// High-level helpers: KV-cache append
// ------------------------------------------------------------------

export async function createKvCachePipeline(device: GPUDevice): Promise<ComputePipeline> {
  return createComputePipeline(
    device,
    'kvCache',
    'appendKvCache',
    [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
    'kv-cache-append',
  );
}
