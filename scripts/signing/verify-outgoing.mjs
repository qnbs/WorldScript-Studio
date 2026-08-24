#!/usr/bin/env node
import process from 'node:process';
import { readPrePushEvidenceFile, verifyOutgoingUpdates } from './signing-core.mjs';

const args = process.argv.slice(2);
const remote = args[0];
const evidenceIndex = args.indexOf('--prepush-evidence-file');
const evidenceFile = evidenceIndex >= 0 ? args[evidenceIndex + 1] : null;
if (!remote) {
  console.error(
    'pre-push signing check requires the remote name. Run "pnpm run hooks:install" to refresh the installed hook.',
  );
  process.exit(1);
}
try {
  let input;
  if (evidenceIndex >= 0) input = readPrePushEvidenceFile(evidenceFile);
  else {
    let stream = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) stream += chunk;
    input = stream;
  }
  const result = verifyOutgoingUpdates(input, remote);
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
