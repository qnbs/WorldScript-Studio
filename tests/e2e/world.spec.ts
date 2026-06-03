import { expect, test } from '@playwright/test';
import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('World Building CRUD (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('Add Manually opens the atlas editor and the world appears in the list', async ({
    page,
  }) => {
    await clickNavItem(page, /World Building/i);
    await page
      .getByRole('button', { name: /Add Manually/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    await page.getByRole('button', { name: /Add Manually/i }).click();

    // QNBS-v3 regression: manual add must open the atlas editor immediately (parity with
    // Characters). Previously it silently added a card with no editor — perceived as broken.
    const nameInput = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.clear();
    await nameInput.fill('Aethelgard');

    // DebouncedInput fires after ~750ms — wait before closing so the rename persists
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');

    await expect(page.getByText('Aethelgard')).toBeVisible({ timeout: 8000 });
  });

  test('adding two worlds shows both in the list', async ({ page }) => {
    await clickNavItem(page, /World Building/i);
    await page
      .getByRole('button', { name: /Add Manually/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    for (const name of ['Valdoria', 'Mistreach']) {
      await page.getByRole('button', { name: /Add Manually/i }).click();
      const input = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
      await expect(input).toBeVisible({ timeout: 8000 });
      await input.clear();
      await input.fill(name);
      await page.waitForTimeout(900);
      await page.keyboard.press('Escape');
      await expect(page.getByText(name)).toBeVisible({ timeout: 8000 });
    }

    await expect(page.getByText('Valdoria')).toBeVisible();
    await expect(page.getByText('Mistreach')).toBeVisible();
  });
});
