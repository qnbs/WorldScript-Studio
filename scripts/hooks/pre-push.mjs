import process from 'node:process';
import { runNodeScript } from './shared.mjs';

process.exit(runNodeScript('scripts/ci-prepush-lowend.mjs'));
