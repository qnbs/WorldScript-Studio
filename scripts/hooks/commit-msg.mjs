import { readFileSync } from 'node:fs';
import process from 'node:process';
import { checkAttributionText } from '../check-commit-attribution.mjs';

const file = process.argv[2];
if (!file) {
  console.error('commit-msg hook requires the commit message file path.');
  process.exit(1);
}
let message;
try {
  message = readFileSync(file, 'utf8');
} catch (error) {
  console.error(
    `commit-msg hook cannot read ${file}: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
}
const result = checkAttributionText(message);
if (!result.ok) {
  console.error(
    `commit rejected: forbidden AI/session attribution pattern(s) ${result.matches.join(', ')} — see AGENTS.md.`,
  );
  process.exit(1);
}
process.exit(0);
