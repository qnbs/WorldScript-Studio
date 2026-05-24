#!/usr/bin/env node
/**
 * Optional pre-commit helper: runs codegraph affected and logs a reminder.
 * Not enforced by default to keep commits fast. Exit code is always 0.
 * QNBS-v3: informative only; does not block commits.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.codegraph/codegraph.db')) {
  console.log('ℹ️  CodeGraph not initialized. Skipping affected-test analysis.');
  process.exit(0);
}

try {
  const affected = execSync('git diff --cached --name-only | codegraph affected --stdin --quiet', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (affected.trim()) {
    console.log('🧪 CodeGraph detected affected test files:');
    console.log(affected);
    console.log(`Run: pnpm exec vitest run ${affected.trim().split('\n').join(' ')}`);
  }
} catch {
  // Silently ignore if codegraph CLI is not on PATH or fails
  process.exit(0);
}
