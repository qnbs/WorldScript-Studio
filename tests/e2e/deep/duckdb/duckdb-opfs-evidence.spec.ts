/**
 * Evidence (never merged, #716): DuckDB-WASM OPFS behaviour, recorded per phase. The workflow runs this once against
 * the dev server and once against the production build, so a dev-only artefact can be told from a shipped defect.
 * Phases: one tab edits → the same tab reloads and edits → a second tab of the same origin edits.
 */
import { expect, type Page, test } from '@playwright/test';

import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from '../../helpers';

const RELEVANT = /duckdb|opfs|access ?handle|catalog error|circuit|dual-write|analytics/i;

function record(page: Page, phase: { name: string }, sink: string[]): void {
  page.on('console', (message) => {
    const text = message.text();
    if (RELEVANT.test(text) || message.type() === 'error') {
      sink.push(`[${phase.name}][${message.type()}] ${text.replace(/\s+/g, ' ').slice(0, 320)}`);
    }
  });
  page.on('pageerror', (error) =>
    sink.push(`[${phase.name}][pageerror] ${String(error).slice(0, 320)}`),
  );
}

async function editManuscript(page: Page, text: string): Promise<void> {
  await clickNavItem(page, /Manuscript/i);
  const textarea = page.getByTestId('manuscript-editor-textarea').first();
  await expect(textarea).toBeVisible({ timeout: 20_000 });
  await textarea.fill(text);
  // Long enough for autosave and the DuckDB dual-write (with its retries) to run.
  await page.waitForTimeout(15_000);
}

test.setTimeout(300_000);

test('records DuckDB OPFS behaviour across one tab, a reload and a second tab', async ({
  page,
  context,
}) => {
  const lines: string[] = [];
  const phase = { name: 'tab1' };
  record(page, phase, lines);
  await page.goto('/');
  await waitForSpaReady(page);
  await selectEnglish(page);
  await ensureBlankProject(page);
  await editManuscript(page, 'First line written for the DuckDB evidence.');

  phase.name = 'tab1-reload';
  await page.reload();
  await waitForSpaReady(page);
  await editManuscript(page, 'Second line, written after a reload.');

  phase.name = 'tab1-while-tab2';
  const second = await context.newPage();
  record(second, { name: 'tab2' }, lines);
  await second.goto('/');
  await waitForSpaReady(second);
  await editManuscript(second, 'A line written in a second tab.');
  await page.waitForTimeout(5_000);

  const summary = new Map<string, number>();
  for (const line of lines) {
    const key = line.replace(/\d+/g, '#').slice(0, 160);
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  console.log(`[evidence] ${lines.length} relevant console lines, ${summary.size} distinct`);
  for (const [key, count] of summary) console.log(`[evidence] ${count}x ${key}`);
});
