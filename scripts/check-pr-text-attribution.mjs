#!/usr/bin/env node
/**
 * CI-only companion to check-commit-attribution.mjs: checks PR title/body text, which local hooks
 * never see. Parses GITHUB_EVENT_PATH in Node — never interpolate PR text into a shell command.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { checkAttributionText } from './check-commit-attribution.mjs';

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  console.log('[check-pr-text-attribution] no GITHUB_EVENT_PATH — skipping');
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(eventPath, 'utf8'));
} catch (error) {
  console.error(
    `[check-pr-text-attribution] cannot read event payload: ${error instanceof Error ? error.message : 'invalid JSON'}`,
  );
  process.exit(1);
}

const pr = payload.pull_request;
if (!pr) {
  console.log('[check-pr-text-attribution] not a pull_request event — skipping');
  process.exit(0);
}

const failures = [];
for (const [field, text] of [
  ['title', pr.title],
  ['body', pr.body],
]) {
  const result = checkAttributionText(text ?? '');
  if (!result.ok) failures.push({ field, matches: result.matches });
}

if (failures.length > 0) {
  for (const f of failures) {
    console.error(
      `[check-pr-text-attribution] PR ${f.field}: forbidden pattern(s) ${f.matches.join(', ')}`,
    );
  }
  console.error(
    '[check-pr-text-attribution] FAIL — remove AI/model/session attribution from the PR title/body (see AGENTS.md).',
  );
  process.exit(1);
}
console.log('[check-pr-text-attribution] OK');
