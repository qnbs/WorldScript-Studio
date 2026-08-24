import { readFileSync } from 'node:fs';
import process from 'node:process';
import { runNodeScript } from './shared.mjs';

// QNBS-v3: preserve the one-shot ref update stream so admission checks validate the exact outgoing range.
const updates = readFileSync(0, 'utf8');
const options = { input: updates };
// QNBS-v3: resolve all-zero remote refs against the remote being pushed, not a hard-coded origin.
process.env.WORLD_SCRIPT_PREPUSH_REMOTE_NAME = process.argv[2] ?? 'origin';

if (
  (await runNodeScript('scripts/signing/verify-outgoing.mjs', process.argv.slice(2), options)) !== 0
)
  process.exit(1);
process.env.WORLD_SCRIPT_PREPUSH_UPDATES = updates;
process.exit(
  await runNodeScript('scripts/ci-prepush-lowend.mjs', [], {
    env: process.env,
    timeoutMs: 900_000,
  }),
);
