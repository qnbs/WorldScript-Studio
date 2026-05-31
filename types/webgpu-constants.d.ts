// QNBS-v3: WebGPU flag constant namespaces — TypeScript lib.dom.d.ts defines WebGPU
// interfaces but does NOT declare the constant namespace objects as values.
// These declarations make GPUShaderStage.COMPUTE / GPUBufferUsage.STORAGE etc.
// available to tsc without requiring @webgpu/types.

declare namespace GPUShaderStage {
  const VERTEX: 1;
  const FRAGMENT: 2;
  const COMPUTE: 4;
}

declare namespace GPUBufferUsage {
  const MAP_READ: 1;
  const MAP_WRITE: 2;
  const COPY_SRC: 4;
  const COPY_DST: 8;
  const INDEX: 16;
  const VERTEX: 32;
  const UNIFORM: 64;
  const STORAGE: 128;
  const INDIRECT: 256;
  const QUERY_RESOLVE: 512;
}

declare namespace GPUMapMode {
  const READ: 1;
  const WRITE: 2;
}
