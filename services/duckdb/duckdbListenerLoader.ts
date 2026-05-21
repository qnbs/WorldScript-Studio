// QNBS-v3: Lazy loaders for DuckDB/RAG — keeps heavy modules out of the initial bundle graph.

export async function loadDuckdbAnalytics() {
  return import('./duckdbAnalytics');
}

export async function loadDuckdbMigration() {
  return import('./duckdbMigration');
}

export async function loadRagVectorMigration() {
  return import('./ragVectorMigration');
}

export async function loadLocalRagService() {
  return import('../localRagService');
}
