import process from 'node:process';
import { parsePrePushInput, serializePrePushUpdates } from '../signing/signing-core.mjs';
import { runNodeScript } from './shared.mjs';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
try {
  const updates = parsePrePushInput(input);
  process.env.WORLD_SCRIPT_PREPUSH_UPDATES = serializePrePushUpdates(updates);
} catch (error) {
  console.error(
    `pre-push evidence capture failed closed: ${error instanceof Error ? error.message : 'invalid input'}`,
  );
  process.exit(1);
}

if (runNodeScript('scripts/signing/verify-outgoing.mjs', process.argv.slice(2)) !== 0)
  process.exit(1);
process.exit(runNodeScript('scripts/ci-prepush-lowend.mjs'));
