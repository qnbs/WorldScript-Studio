import { expect, test } from '@playwright/test';

import {
  ensureBlankProject,
  selectEnglish,
  sidebar,
  waitForSpaReady,
  writerSectionSelect,
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
    await sidebar(page)
      .getByRole('button', { name: /^Export$/i })
      .click();
    await page
      .getByRole('button', { name: /Import Project/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    // The Import Project button triggers a file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import Project/i }).click();
    const fileChooser = await fileChooserPromise;

    // Upload the minimal JSON fixture as a buffer
    await fileChooser.setFiles({
      name: 'test-project.json',
      mimeType: 'application/json',
      buffer: Buffer.from(MINIMAL_PROJECT, 'utf-8'),
    });

    // Success toast or heading should reflect the imported title
    await expect(page.getByText(/imported successfully|Imported Test Novel/i)).toBeVisible({
      timeout: 10000,
    });

    // Navigate to Writer to verify manuscript section landed
    await sidebar(page)
      .getByRole('button', { name: /AI Writing Studio/i })
      .click();
    const sectionSelect = writerSectionSelect(page);
    await expect(sectionSelect).toBeVisible({ timeout: 8000 });
    await expect(sectionSelect.locator('option', { hasText: /Chapter One/i })).toBeAttached();
  });

  test('import survives a page reload (IndexedDB persistence)', async ({ page }) => {
    // Import first
    await sidebar(page)
      .getByRole('button', { name: /^Export$/i })
      .click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import Project/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'persist-test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(MINIMAL_PROJECT, 'utf-8'),
    });
    await expect(page.getByText(/imported successfully|Imported Test Novel/i)).toBeVisible({
      timeout: 10000,
    });

    // Reload and check title is still present
    await page.reload();
    await waitForSpaReady(page);
    await expect(page.getByText(/Imported Test Novel/i)).toBeVisible({ timeout: 8000 });
  });

  test('rejects a malformed JSON file gracefully', async ({ page }) => {
    await sidebar(page)
      .getByRole('button', { name: /^Export$/i })
      .click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import Project/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ this is: not valid JSON }', 'utf-8'),
    });

    // App must show an error, not crash
    await expect(page.getByText(/error|failed|ungültig/i)).toBeVisible({ timeout: 8000 });
    await expect(page.locator('body')).toBeVisible();
  });
});
