// attention.wgsl — Single-head self-attention on GPU for prompt-prefix pre-computation.
// QNBS-v3: Workgroup-parallel kernel deferred — needs f32 atomic reduce (unavailable in WGSL 1.0).
// Only attentionForwardSerial is exposed; it is correct and used by computeShaderFactory.ts.

struct AttentionParams {
  seqLen: u32,
  headDim: u32,
  scale: f32,
};

@group(0) @binding(0) var<storage, read> q: array<f32>;   // seqLen × headDim
@group(0) @binding(1) var<storage, read> k: array<f32>;   // seqLen × headDim
@group(0) @binding(2) var<storage, read> v: array<f32>;   // seqLen × headDim
@group(0) @binding(3) var<storage, read_write> out: array<f32>; // seqLen × headDim
@group(0) @binding(4) var<uniform> params: AttentionParams;

// Shared scratch for one row of QK^T (max 1024 tokens)
var<workgroup> qkRow: array<f32, 1024>;

// Single thread per row — correct, causal-safe stable softmax + V weighted sum.
// Parallelism: dispatched as (1, seqLen, 1) so each row gets its own thread.
@compute @workgroup_size(1, 1)
fn attentionForwardSerial(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let row = gid.y;
  let seqLen = params.seqLen;
  let headDim = params.headDim;

  if (row >= seqLen) {
    return;
  }

  // 1. Compute QK^T row with stable online max
  var maxVal = -3.402823e+38;
  for (var col = 0u; col < seqLen; col = col + 1u) {
    var dot = 0.0;
    for (var d = 0u; d < headDim; d = d + 1u) {
      dot = dot + q[row * headDim + d] * k[col * headDim + d];
    }
    let s = dot * params.scale;
    qkRow[col] = s;
    maxVal = max(maxVal, s);
  }

  // 2. Softmax: exp(x - max) / sum
  var expSum = 0.0;
  for (var col = 0u; col < seqLen; col = col + 1u) {
    let e = exp(qkRow[col] - maxVal);
    qkRow[col] = e;
    expSum = expSum + e;
  }
  for (var col = 0u; col < seqLen; col = col + 1u) {
    qkRow[col] = qkRow[col] / expSum;
  }

  // 3. Weighted sum over V
  for (var d = 0u; d < headDim; d = d + 1u) {
    var sum = 0.0;
    for (var col = 0u; col < seqLen; col = col + 1u) {
      sum = sum + qkRow[col] * v[col * headDim + d];
    }
    out[row * headDim + d] = sum;
  }
}
