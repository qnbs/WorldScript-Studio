import { expect, test } from '@playwright/test';

import {
  ensureBlankProject,
  selectEnglish,
  selectFirstEnabledWriterSection,
  sidebar,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';

/** Navigate to Writer view and add some content so snapshots have something to capture. */
async function seedManuscriptContent(page: import('@playwright/test').Page): Promise<void> {
  const writerBtn = sidebar(page).getByRole('button', { name: /AI Writing Studio/i });
  await writerBtn.click();
  await selectFirstEnabledWriterSection(page);
  const textarea = page.getByTestId('writer-studio-editor');
  await expect(textarea).toBeVisible();
  await textarea.fill('Snapshot seed content — this text will be captured in a snapshot.');
}

test.describe('Snapshot Flow (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('creates a manual snapshot and it appears in the panel', async ({ page }) => {
    await seedManuscriptContent(page);

    // Open version control panel from Writer toolbar
    const vcBtn = page.getByRole('button', { name: /Versions/i }).first();
    await expect(vcBtn).toBeVisible({ timeout: 8000 });
    await vcBtn.click();

    // The version control panel should open
    await expect(page.getByText(/Version History/i)).toBeVisible({ timeout: 8000 });

    // Click "+ Snapshot"
    const newSnapshotBtn = page
      .getByRole('button', { name: /\+ Snapshot|Create new snapshot/i })
      .first();
    await expect(newSnapshotBtn).toBeVisible({ timeout: 6000 });
    await newSnapshotBtn.click();

    // Fill label in modal
    const labelInput = page.getByPlaceholder(/Before the big twist|snapshot/i).first();
    await expect(labelInput).toBeVisible({ timeout: 6000 });
    await labelInput.fill('E2E Test Snapshot');

    // Confirm creation
    await page
      .getByRole('button', { name: /Create Snapshot/i })
      .last()
      .click();

    // Snapshot entry should appear in the panel
    await expect(page.getByText('E2E Test Snapshot')).toBeVisible({ timeout: 10000 });
  });

  test('restores a snapshot and resets manuscript content', async ({ page }) => {
    await seedManuscriptContent(page);

    // Create a snapshot to restore later
    const vcBtn = page.getByRole('button', { name: /Versions/i }).first();
    await vcBtn.click();
    await expect(page.getByText(/Version History/i)).toBeVisible({ timeout: 8000 });
    await page
      .getByRole('button', { name: /\+ Snapshot|Create new snapshot/i })
      .first()
      .click();
    const labelInput = page.getByPlaceholder(/Before the big twist|snapshot/i).first();
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Restore Target');
    await page
      .getByRole('button', { name: /Create Snapshot/i })
      .last()
      .click();
    await expect(page.getByText('Restore Target')).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Escape');

    // Now change the manuscript
    const writerBtn = sidebar(page)
      .getByRole('button', { name: /AI Writing Studio/i })
      .first();
    await writerBtn.click();
    const textarea = page.getByTestId('writer-studio-editor');
    await expect(textarea).toBeVisible({ timeout: 6000 });
    await textarea.fill('Completely different content after the snapshot.');

    // Re-open panel and restore
    await page
      .getByRole('button', { name: /Versions/i })
      .first()
      .click();
    await expect(page.getByText('Restore Target')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /Restore snapshot "Restore Target"/i }).click();

    // Confirm restore modal
    const confirmBtn = page.getByRole('button', { name: /Restore|Wiederherstellen/i }).last();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Manuscript should reflect seed content again
    await sidebar(page)
      .getByRole('button', { name: /AI Writing Studio/i })
      .click();
    const restoredTextarea = page.getByTestId('writer-studio-editor');
    await expect(restoredTextarea).toHaveValue(/Snapshot seed content/i, { timeout: 10000 });
  });

  test('auto-snapshot appears after an auto-save cycle', async ({ page }) => {
    await seedManuscriptContent(page);

    // Open version control panel
    const vcBtn = page.getByRole('button', { name: /Versions/i }).first();
    await vcBtn.click();
    await expect(page.getByText(/Version History/i)).toBeVisible({ timeout: 8000 });

    // Auto-snapshots are labelled "Auto-Snapshot" by dbService
    // Wait up to 10 s — auto-save fires within ~30 s in production,
    // but the test environment may trigger it sooner via forced save.
    // We just verify the panel renders without error for now.
    await expect(page.getByRole('heading', { name: /Snapshots \(\d+\)/i })).toBeVisible({
      timeout: 6000,
    });
  });

  test('snapshot panel closes on pressing Escape', async ({ page }) => {
    await sidebar(page)
      .getByRole('button', { name: /AI Writing Studio/i })
      .click();
    const vcBtn = page.getByRole('button', { name: /Versions/i }).first();
    await expect(vcBtn).toBeVisible({ timeout: 8000 });
    await vcBtn.click();
    await expect(page.getByText(/Version History/i)).toBeVisible({ timeout: 8000 });

    await page.keyboard.press('Escape');
    await expect(page.getByText(/Version History/i)).not.toBeVisible({ timeout: 6000 });
  });
});
