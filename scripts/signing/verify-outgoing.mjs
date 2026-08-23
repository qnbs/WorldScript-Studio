#!/usr/bin/env node
import process from 'node:process';
import { verifyOutgoingUpdates } from './signing-core.mjs';

const remote = process.argv[2];
if (!remote) {
  console.error(
    'pre-push signing check requires the remote name. Run "pnpm run hooks:install" to refresh the installed hook.',
  );
  process.exit(1);
}
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const lines = input.split(/\r?\n/).filter(Boolean);
try {
  const result = verifyOutgoingUpdates(lines, remote);
  if (!result.ok) {
    console.error(`pre-push signing check rejected the update: ${result.reason}`);
    process.exit(1);
  }
  console.log(`pre-push signing check verified ${result.reports.length} outgoing object(s)`);
} catch (error) {
  console.error(
    `pre-push signing check failed closed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
}
