/**
 * Evidence (never merged, #1272/#1273): in the production build, every worker the app starts must load a bundled
 * JavaScript file, and nothing may loop. The workflow also runs this against a build whose #1273 files are set back to
 * main, as a negative control that must fail.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from '../../helpers';

const WORKER_FAILURE =
  /Failed to construct 'Worker'|video\/mp2t|MIME type|worker crashed|stopped after \d+ consecutive worker crashes/i;
const DUCKDB = /duckdb|analytics|opfs/i;

test.setTimeout(240_000);

test('production build: every worker loads as bundled JavaScript and nothing loops', async ({
  page,
}) => {
  const workers: string[] = [];
  const workerScripts: { path: string; status: number; type: string }[] = [];
  // Counted, not stored: the pre-fix build floods the console (#1272 measured 139,648 errors in about three minutes).
  const failureSamples = new Set<string>();
  const duckdbLines = new Set<string>();
  let failureCount = 0;
  let consoleErrors = 0;
  const noteFailure = (text: string) => {
    failureCount += 1;
    if (failureSamples.size < 5) failureSamples.add(text.slice(0, 240));
  };

  page.on('worker', (worker) => {
    if (workers.length < 50) workers.push(worker.url().slice(0, 160));
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (workerScripts.length < 50 && /\/assets\/worker-[^/]+$|\.ts$/.test(path)) {
      workerScripts.push({
        path,
        status: response.status(),
        type: response.headers()['content-type'] ?? '',
      });
    }
  });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') consoleErrors += 1;
    if (WORKER_FAILURE.test(text)) noteFailure(text);
    if (DUCKDB.test(text) && duckdbLines.size < 20) {
      duckdbLines.add(`[${message.type()}] ${text.slice(0, 200)}`);
    }
  });
  page.on('pageerror', (error) => {
    if (WORKER_FAILURE.test(String(error))) noteFailure(String(error));
  });

  const summary = () => ({
    workersStarted: workers.length,
    workers: workers.slice(0, 12),
    workerScripts: workerScripts.slice(0, 12),
    consoleErrors,
    workerFailures: failureCount,
    failureSamples: [...failureSamples],
    duckdbLines: [...duckdbLines],
  });
  try {
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
    await clickNavItem(page, /Manuscript/i);
    const textarea = page.getByTestId('manuscript-editor-textarea').first();
    await expect(textarea).toBeVisible({ timeout: 20_000 });
    await textarea.fill('A line written for the production worker evidence.');
    // Long enough for autosave and the DuckDB dual-write (with its retries and respawn backoff) to run.
    await page.waitForTimeout(25_000);
  } finally {
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/worker-evidence-summary.json', JSON.stringify(summary(), null, 2));
  }

  expect(failureCount, 'worker failure messages').toBe(0);
  expect(workers.length, 'at least one worker started').toBeGreaterThan(0);
  expect(workerScripts.length, 'worker scripts fetched over HTTP').toBeGreaterThan(0);
  for (const script of workerScripts) {
    expect(script.path, 'no raw TypeScript worker').not.toMatch(/\.ts$/);
    expect(script.status, `${script.path} status`).toBe(200);
    expect(script.type, `${script.path} content type`).toMatch(/javascript/);
  }
});
