// kvCache.wgsl — KV-cache append + rotary position embedding update.
// QNBS-v3: Appends new key/value vectors to the growing cache for autoregressive generation.

struct CacheParams {
  batchSize: u32,
  seqLen: u32,        // current sequence length before append
  headDim: u32,
  numHeads: u32,
  numKvHeads: u32,
  newTokens: u32,     // usually 1 for autoregressive step
};

@group(0) @binding(0) var<storage, read_write> kCache: array<f32>; // batch × numKvHeads × maxSeqLen × headDim
@group(0) @binding(1) var<storage, read_write> vCache: array<f32>; // same shape
@group(0) @binding(2) var<storage, read> newK: array<f32>;         // batch × numKvHeads × newTokens × headDim
@group(0) @binding(3) var<storage, read> newV: array<f32>;         // same
@group(0) @binding(4) var<uniform> params: CacheParams;

fn applyRope(qv: f32, kv: f32, pos: u32, dimIdx: u32, headDim: u32) -> vec2<f32> {
  // Simplified RoPE: rotate pairs of dimensions by angle depending on position
  let pair = dimIdx / 2u;
  let invFreq = 1.0 / pow(10000.0, f32(pair * 2u) / f32(headDim));
  let angle = f32(pos) * invFreq;
  let cosA = cos(angle);
  let sinA = sin(angle);
  return vec2<f32>(qv * cosA - kv * sinA, qv * sinA + kv * cosA);
}

@compute @workgroup_size(64)
fn appendKvCache(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let totalElements = params.batchSize * params.numKvHeads * params.newTokens * params.headDim;
  if (idx >= totalElements) {
    return;
  }

  // Flat index decomposition
  let headDim = params.headDim;
  let numKvHeads = params.numKvHeads;
  let newTokens = params.newTokens;
  let seqLen = params.seqLen;

  let d = idx % headDim;
  let t = (idx / headDim) % newTokens;
  let h = (idx / (headDim * newTokens)) % numKvHeads;
  let b = idx / (headDim * newTokens * numKvHeads);

  let cachePos = seqLen + t;
  let cacheStride = numKvHeads * (seqLen + newTokens) * headDim; // per batch
  let cacheOffset = b * cacheStride + h * ((seqLen + newTokens) * headDim) + cachePos * headDim + d;

  let newOffset = b * (numKvHeads * newTokens * headDim) + h * (newTokens * headDim) + t * headDim + d;

  kCache[cacheOffset] = newK[newOffset];
  vCache[cacheOffset] = newV[newOffset];
}

@compute @workgroup_size(64)
fn applyRopeToCache(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let totalElements = params.batchSize * params.numKvHeads * params.seqLen * params.headDim;
  if (idx >= totalElements) {
    return;
  }

  let headDim = params.headDim;
  let numKvHeads = params.numKvHeads;
  let seqLen = params.seqLen;

  let d = idx % headDim;
  let pos = (idx / headDim) % seqLen;
  let h = (idx / (headDim * seqLen)) % numKvHeads;
  let b = idx / (headDim * seqLen * numKvHeads);

  let cacheStride = numKvHeads * seqLen * headDim;
  let cacheOffset = b * cacheStride + h * (seqLen * headDim) + pos * headDim + d;

  // Only rotate even-indexed pairs
  if (d % 2u == 0u && d + 1u < headDim) {
    let x0 = kCache[cacheOffset];
    let x1 = kCache[cacheOffset + 1u];
    let rotated = applyRope(x0, x1, pos, d, headDim);
    kCache[cacheOffset] = rotated.x;
    kCache[cacheOffset + 1u] = rotated.y;
  }
}
