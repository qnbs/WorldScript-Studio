import process from 'node:process';
import { runNodeScript } from './shared.mjs';

if (runNodeScript('scripts/signing/verify-outgoing.mjs', process.argv.slice(2)) !== 0)
  process.exit(1);
process.exit(runNodeScript('scripts/ci-prepush-lowend.mjs'));
