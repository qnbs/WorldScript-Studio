import { expect, test } from '@playwright/test';
import { clickNavItem, ensureBlankProject, selectEnglish, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('Character CRUD (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('creates a character manually and it appears in the list', async ({ page }) => {
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /Characters/i);
    await page
      .getByRole('button', { name: /Add Manually/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    // "Add Manually" is an AddNewCard rendered as <button>
    await page.getByRole('button', { name: /Add Manually/i }).click();

    // Dossier opens immediately with the new character — scope to dialog (Modal role)
    const nameInput = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.clear();
    await nameInput.fill('Elara Voss');

    // Wait for DebouncedInput 750ms debounce to fire before closing
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');

    // Character card should now show the edited name
    await expect(page.getByText('Elara Voss')).toBeVisible({ timeout: 8000 });
  });

  test('edits a character name and the change persists', async ({ page }) => {
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /Characters/i);
    await page
      .getByRole('button', { name: /Add Manually/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    await page.getByRole('button', { name: /Add Manually/i }).click();
    const nameInput = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.clear();
    await nameInput.fill('Braxton Hale');
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Braxton Hale')).toBeVisible({ timeout: 8000 });

    // Click the character card to reopen the dossier
    await page.getByRole('button', { name: /Braxton Hale/i }).click();
    const editInput = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
    await expect(editInput).toBeVisible({ timeout: 6000 });
    await editInput.clear();
    await editInput.fill('Braxton Hale Jr.');
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');

    await expect(page.getByText('Braxton Hale Jr.')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Braxton Hale', { exact: true })).toHaveCount(0);
  });

  test('deletes a character and it disappears from the list', async ({ page }) => {
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /Characters/i);
    await page
      .getByRole('button', { name: /Add Manually/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    await page.getByRole('button', { name: /Add Manually/i }).click();
    const nameInput = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.clear();
    await nameInput.fill('Doomed Character');
    await page.waitForTimeout(900);

    // Delete button is inside the dossier, aria-label = "Delete Doomed Character"
    const deleteBtn = page
      .getByRole('dialog')
      .getByRole('button', { name: /Delete Doomed Character/i });
    await expect(deleteBtn).toBeVisible({ timeout: 6000 });
    await deleteBtn.click();

    // Confirmation modal — confirm button text is "Delete" (second dialog)
    const confirmBtn = page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /^Delete$/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Character must no longer appear in the list
    await expect(page.getByRole('button', { name: /^Doomed Character$/ })).toHaveCount(0);
  });

  test('adding two characters shows both in the list', async ({ page }) => {
    // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
    await clickNavItem(page, /Characters/i);
    await page
      .getByRole('button', { name: /Add Manually/i })
      .waitFor({ state: 'visible', timeout: 15000 });

    for (const name of ['Alpha Char', 'Beta Char']) {
      await page.getByRole('button', { name: /Add Manually/i }).click();
      const input = page.getByRole('dialog').getByRole('textbox', { name: /^Name$/i });
      await expect(input).toBeVisible({ timeout: 8000 });
      await input.clear();
      await input.fill(name);
      await page.waitForTimeout(900);
      await page.keyboard.press('Escape');
      await expect(page.getByText(name)).toBeVisible({ timeout: 8000 });
    }

    await expect(page.getByText('Alpha Char')).toBeVisible();
    await expect(page.getByText('Beta Char')).toBeVisible();
  });
});
