#!/usr/bin/env node
/**
 * Generates CODEGRAPH_REPORT.md from codegraph status + query output.
 * QNBS-v3: mirrors graphify's GRAPH_REPORT.md policy for consistency.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const REPORT_PATH = '.codegraph/CODEGRAPH_REPORT.md';

if (!existsSync('.codegraph/codegraph.db')) {
  console.error('❌ CodeGraph not initialized. Run: codegraph init -i');
  process.exit(1);
}

let report = '# CodeGraph Report\n\n';
report += `**Generated:** ${new Date().toISOString()}\n\n`;

try {
  const status = execSync('codegraph status', { encoding: 'utf-8' });
  report += `## Status\n\n\`\`\`\n${status}\n\`\`\`\n\n`;
} catch (e) {
  report += `## Status\n\nUnavailable: ${String(e)}\n\n`;
}

try {
  const files = execSync('codegraph files --json', { encoding: 'utf-8' });
  const fileList = JSON.parse(files);
  const byExt = fileList.reduce((acc, f) => {
    const ext = f.path.split('.').pop() || 'none';
    acc[ext] = (acc[ext] || 0) + 1;
    return acc;
  }, {});
  report += '## Files by Extension\n\n';
  Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .forEach(([ext, count]) => {
      report += `- **.${ext}**: ${count}\n`;
    });
  report += '\n';
} catch (e) {
  report += `## Files by Extension\n\nUnavailable: ${String(e)}\n\n`;
}

report += '---\n\n';
report += '*Regenerate with: `pnpm run codegraph:report`*\n';

writeFileSync(REPORT_PATH, report);
console.log(`✅ ${REPORT_PATH} generated.`);
