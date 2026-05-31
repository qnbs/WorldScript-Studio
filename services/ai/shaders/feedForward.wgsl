// feedForward.wgsl — Two-layer MLP with GELU activation for transformer block simulation.
// QNBS-v3: Used in compute shader path for lightweight local inference on prompt embeddings.

struct MlpParams {
  batchSize: u32,
  seqLen: u32,
  hiddenSize: u32,
  intermediateSize: u32,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;        // batch × seqLen × hiddenSize
@group(0) @binding(1) var<storage, read> w1: array<f32>;           // hiddenSize × intermediateSize
@group(0) @binding(2) var<storage, read> w2: array<f32>;           // intermediateSize × hiddenSize
@group(0) @binding(3) var<storage, read_write> output: array<f32>; // batch × seqLen × hiddenSize
@group(0) @binding(4) var<uniform> params: MlpParams;

fn gelu(x: f32) -> f32 {
  // GELU approximation: 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
  let c = 0.044715;
  let sqrt2OverPi = 0.7978845608;
  let xx = x * x;
  let xxx = xx * x;
  let inner = sqrt2OverPi * (x + c * xxx);
  return 0.5 * x * (1.0 + tanh(inner));
}

// Each thread processes one token position
@compute @workgroup_size(128)
fn mlpForward(@builtin(global_invocation_id) gid: vec3<u32>) {
  let totalTokens = params.batchSize * params.seqLen;
  let tokenIdx = gid.x;
  if (tokenIdx >= totalTokens) {
    return;
  }

  let hiddenSize = params.hiddenSize;
  let intermediateSize = params.intermediateSize;
  let inputOffset = tokenIdx * hiddenSize;

  // 1. Up-project to intermediateSize
  // QNBS-v3: max 4096 units; factory clamps intermediateSize before dispatch
  var intermediate: array<f32, 4096>;
  for (var i = 0u; i < intermediateSize; i = i + 1u) {
    var sum = 0.0;
    for (var h = 0u; h < hiddenSize; h = h + 1u) {
      sum = sum + input[inputOffset + h] * w1[h * intermediateSize + i];
    }
    intermediate[i] = gelu(sum);
  }

  // 2. Down-project back to hiddenSize
  for (var h = 0u; h < hiddenSize; h = h + 1u) {
    var sum = 0.0;
    for (var i = 0u; i < intermediateSize; i = i + 1u) {
      sum = sum + intermediate[i] * w2[i * hiddenSize + h];
    }
    output[inputOffset + h] = sum;
  }
}
