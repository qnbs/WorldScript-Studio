#!/usr/bin/env node
import { verifyCommitRange } from './signing-core.mjs';

const range = process.argv[2];
if (!range) {
  console.error('usage: pnpm run signing:check-range -- <before..after>');
  process.exit(2);
}
try {
  const reports = verifyCommitRange(range);
  for (const report of reports) {
    console.log(
      `${report.sha.slice(0, 12)} ${report.verification.ok ? 'verified' : 'REJECTED'} ${report.verification.reason} ${report.subject}`,
    );
  }
  process.exit(reports.every((report) => report.verification.ok) ? 0 : 1);
} catch (error) {
  console.error(
    `signing range check failed: ${error instanceof Error ? error.message : 'invalid Git range'}`,
  );
  process.exit(1);
}
