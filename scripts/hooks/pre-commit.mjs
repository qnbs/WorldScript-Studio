import process from 'node:process';
import { ensureDependencyState, runLocalBinary, runNodeScript } from './shared.mjs';

if (runNodeScript('scripts/signing/doctor.mjs', ['--hook']) !== 0) process.exit(1);
if (!ensureDependencyState()) process.exit(1);
process.exit(runLocalBinary('lint-staged'));
