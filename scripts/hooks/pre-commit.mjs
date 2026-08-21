import process from 'node:process';
import { ensureDependencyState, runLocalBinary } from './shared.mjs';

if (!ensureDependencyState()) process.exit(1);
process.exit(runLocalBinary('lint-staged'));
