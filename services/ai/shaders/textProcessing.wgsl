// textProcessing.wgsl — Batch text normalization + cosine similarity for RAG ranking.
// QNBS-v3: Each workgroup processes one document vector against the query vector.

struct Params {
  numDocuments: u32,
  vectorDim: u32,
};

@group(0) @binding(0) var<storage, read> queryVector: array<f32>;
@group(0) @binding(1) var<storage, read> docMatrix: array<f32>; // numDocuments × vectorDim
@group(0) @binding(2) var<storage, read_write> similarities: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn batchCosineSimilarity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let docIdx = gid.x;
  if (docIdx >= params.numDocuments) {
    return;
  }

  var dot = 0.0;
  var qNorm = 0.0;
  var dNorm = 0.0;

  for (var i = 0u; i < params.vectorDim; i = i + 1u) {
    let q = queryVector[i];
    let d = docMatrix[docIdx * params.vectorDim + i];
    dot = dot + q * d;
    qNorm = qNorm + q * q;
    dNorm = dNorm + d * d;
  }

  let denom = sqrt(qNorm) * sqrt(dNorm);
  if (denom > 0.0) {
    similarities[docIdx] = dot / denom;
  } else {
    similarities[docIdx] = 0.0;
  }
}

@compute @workgroup_size(256)
fn vectorAdd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.vectorDim) {
    return;
  }
  // docMatrix[0..dim] += queryVector[0..dim]
  docMatrix[idx] = docMatrix[idx] + queryVector[idx];
}

@compute @workgroup_size(256)
fn vectorScale(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.vectorDim) {
    return;
  }
  // docMatrix[0..dim] *= queryVector[0] (scalar in first element)
  docMatrix[idx] = docMatrix[idx] * queryVector[0];
}
