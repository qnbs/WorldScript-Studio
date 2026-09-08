#!/usr/bin/env node
import process from 'node:process';
import { checkAttributionForOutgoingUpdates, readPrePushEvidenceFile } from './signing-core.mjs';

const args = process.argv.slice(2);
const remote = args[0];
const evidenceIndex = args.indexOf('--prepush-evidence-file');
const evidenceFile = evidenceIndex >= 0 ? args[evidenceIndex + 1] : null;
if (!remote || !evidenceFile) {
  console.error(
    'pre-push attribution check requires the remote name and evidence file. Run "pnpm run hooks:install" to refresh the installed hook.',
  );
  process.exit(1);
}
try {
  const input = readPrePushEvidenceFile(evidenceFile);
  const result = checkAttributionForOutgoingUpdates(input, remote);
  if (!result.ok) {
    console.error(`pre-push attribution check rejected the update: ${result.reason}`);
    console.error(
      'Remove AI/model/session attribution from commit messages before pushing (see AGENTS.md).',
    );
    process.exit(1);
  }
  console.log(`pre-push attribution check verified ${result.reports.length} outgoing commit(s)`);
} catch (error) {
  console.error(
    `pre-push attribution check failed closed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
}
