import { expect, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  selectFirstEnabledWriterSection,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';

const MINIMAL_PROJECT = JSON.stringify({
  title: 'Imported Test Novel',
  logline: 'A test import verifying the full import pipeline.',
  manuscript: [
    { id: 'sec-1', title: 'Chapter One', content: 'The imported chapter content lives here.' },
  ],
  characters: [],
  worlds: [],
});

/** Advanced import opens a modal first; the native file picker is triggered by the dialog's Import action. */
async function importJsonViaModal(
  page: import('@playwright/test').Page,
  file: { name: string; buffer: Buffer },
): Promise<void> {
  // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
  await clickNavItem(page, /^Export$/i);
  const importProjectBtn = page.getByRole('button', { name: /Import Project/i });
  await importProjectBtn.scrollIntoViewIfNeeded();
  await importProjectBtn.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Import$/i })
    .click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: file.name,
    mimeType: 'application/json',
    buffer: file.buffer,
  });
}

test.describe('Project Import (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('imports a JSON project and reflects title + manuscript', async ({ page }) => {
    // Navigate to Export/Import view
    await importJsonViaModal(page, {
      name: 'test-project.json',
      buffer: Buffer.from(MINIMAL_PROJECT, 'utf-8'),
    });

    await expect(
      page.getByText('Project imported successfully', { exact: true }).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    // Navigate to Writer to verify manuscript section landed
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /AI Writing Studio/i);
    // QNBS-v3: selectFirstEnabledWriterSection activates context tab on mobile so the select is visible;
    // first() avoids strict-mode violation when both mobile + desktop ContextPanel are in DOM
    await selectFirstEnabledWriterSection(page);
    const sectionSel = page.locator('#writer-section-select').first();
    await expect(sectionSel.locator('option', { hasText: /Chapter One/i })).toBeAttached();
  });

  test('import survives a page reload (IndexedDB persistence)', async ({ page }) => {
    // Import first
    await importJsonViaModal(page, {
      name: 'persist-test.json',
      buffer: Buffer.from(MINIMAL_PROJECT, 'utf-8'),
    });
    await expect(
      page.getByText('Project imported successfully', { exact: true }).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    // QNBS-v3: listenerMiddleware debounced save ~1000ms — reload before IndexedDB write loads “My Untitled Story”.
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /Dashboard/i);
    await expect(page.locator('#projectTitle')).toHaveValue('Imported Test Novel', {
      timeout: 10000,
    });
    await page.waitForTimeout(1800);

    // Reload and check title is still present (Dashboard shows project title input)
    await page.reload();
    await waitForSpaReady(page);
    await selectEnglish(page);
    await clickNavItem(page, /Dashboard/i);
    await expect(page.locator('#projectTitle')).toHaveValue('Imported Test Novel', {
      timeout: 15000,
    });
  });

  test('rejects a malformed JSON file gracefully', async ({ page }) => {
    await importJsonViaModal(page, {
      name: 'broken.json',
      buffer: Buffer.from('{ this is: not valid JSON }', 'utf-8'),
    });

    // App must show an error, not crash (toast uses export.importFailed in EN)
    await expect(page.getByText(/Import failed/i).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('body')).toBeVisible();
  });
});
