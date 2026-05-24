#!/usr/bin/env node
/**
 * Unified update script for both Graphify and CodeGraph.
 * QNBS-v3: Ensures both knowledge graphs stay in sync after large refactors.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

console.log('🔄 Dual-Graph Update started...\n');

// 1. Graphify update (AST-only, no API cost)
console.log('📊 Updating Graphify...');
const graphifyResult = spawnSync(process.execPath, ['scripts/graphify-update.mjs'], {
  stdio: 'inherit',
  cwd: process.cwd(),
});
if (graphifyResult.status !== 0) {
  console.warn('⚠️ Graphify update returned non-zero. Continuing...');
}

// 2. CodeGraph update
if (existsSync('.codegraph/codegraph.db')) {
  console.log('\n🔍 Updating CodeGraph...');
  const cgResult = spawnSync('codegraph', ['index', '--force'], {
    stdio: 'inherit',
  });
  if (cgResult.status !== 0) {
    console.warn('⚠️ CodeGraph index returned non-zero.');
  }

  console.log('\n📝 Generating CodeGraph report...');
  const reportResult = spawnSync(process.execPath, ['scripts/codegraph-report.mjs'], {
    stdio: 'inherit',
  });
  if (reportResult.status !== 0) {
    console.warn('⚠️ CodeGraph report generation failed.');
  }
} else {
  console.log('\n⏭️ CodeGraph not initialized. Skipping. Run: codegraph init -i');
}

console.log('\n✅ Dual-Graph Update complete.');
console.log('Remember: Only GRAPH_REPORT.md and CODEGRAPH_REPORT.md should be committed.');
