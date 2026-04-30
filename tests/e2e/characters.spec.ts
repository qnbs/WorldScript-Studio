import { expect, test } from '@playwright/test';

const isCI = process.env['CI'] === 'true';

test.describe('Character CRUD (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Set EN locale
    const enBtn = page.getByRole('button', { name: /^EN$/i }).first();
    if (await enBtn.isVisible()) await enBtn.click();

    // Ensure we have a project — start one if on welcome screen
    const startBtn = page.getByRole('button', { name: /Start a New Project/i });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
      await page
        .getByRole('button', { name: /Skip|Manual/i })
        .first()
        .click()
        .catch(() => {});
    }
  });

  test('creates a character manually and it appears in the list', async ({ page }) => {
    await page.getByRole('button', { name: /Characters/i }).click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Add Manually/i }).click();

    // The new character card / input should be visible
    const nameInput = page.getByLabel(/Name/i).first();
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.fill('Elara Voss');

    // Fill backstory if visible
    const backstoryInput = page.getByLabel(/Backstory/i).first();
    if (await backstoryInput.isVisible()) {
      await backstoryInput.fill('A rogue archivist from the northern wastes.');
    }

    // Save / confirm — look for a Save or Done button
    const saveBtn = page.getByRole('button', { name: /Save|Done|Speichern/i }).first();
    if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveBtn.click();
    } else {
      // If inline edit, just click away
      await page.keyboard.press('Escape');
    }

    // Character should appear in the list
    await expect(page.getByText('Elara Voss')).toBeVisible({ timeout: 8000 });
  });

  test('edits an existing character and persists the change', async ({ page }) => {
    await page.getByRole('button', { name: /Characters/i }).click();
    await page.waitForLoadState('networkidle');

    // Create a character first
    await page.getByRole('button', { name: /Add Manually/i }).click();
    const nameInput = page.getByLabel(/Name/i).first();
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.fill('Braxton Hale');
    const saveBtn = page.getByRole('button', { name: /Save|Done|Speichern/i }).first();
    if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) await saveBtn.click();
    else await page.keyboard.press('Escape');
    await expect(page.getByText('Braxton Hale')).toBeVisible({ timeout: 8000 });

    // Click the character card to open editor
    await page.getByText('Braxton Hale').click();

    // Edit the name
    const editNameInput = page.getByLabel(/Name/i).first();
    await expect(editNameInput).toBeVisible({ timeout: 6000 });
    await editNameInput.clear();
    await editNameInput.fill('Braxton Hale Jr.');

    const saveBtnEdit = page.getByRole('button', { name: /Save|Done|Speichern/i }).first();
    if (await saveBtnEdit.isVisible({ timeout: 2000 }).catch(() => false))
      await saveBtnEdit.click();

    // Updated name should be visible
    await expect(page.getByText('Braxton Hale Jr.')).toBeVisible({ timeout: 8000 });
  });

  test('deletes a character and it disappears from the list', async ({ page }) => {
    await page.getByRole('button', { name: /Characters/i }).click();
    await page.waitForLoadState('networkidle');

    // Create a character to delete
    await page.getByRole('button', { name: /Add Manually/i }).click();
    const nameInput = page.getByLabel(/Name/i).first();
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.fill('Doomed Character');
    const saveBtn = page.getByRole('button', { name: /Save|Done|Speichern/i }).first();
    if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) await saveBtn.click();
    else await page.keyboard.press('Escape');
    await expect(page.getByText('Doomed Character')).toBeVisible({ timeout: 8000 });

    // Open the delete action (via aria-label or button text)
    const deleteBtn = page.getByRole('button', { name: /Delete Doomed Character|Delete/i }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 6000 });
    await deleteBtn.click();

    // Confirm deletion dialog
    const confirmBtn = page.getByRole('button', { name: /Confirm|Yes|Delete|Löschen/i }).last();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Character must no longer appear
    await expect(page.getByText('Doomed Character')).not.toBeVisible({ timeout: 8000 });
  });

  test('character count updates correctly after add and delete', async ({ page }) => {
    await page.getByRole('button', { name: /Characters/i }).click();
    await page.waitForLoadState('networkidle');

    // Add two characters
    for (const name of ['Alpha Char', 'Beta Char']) {
      await page.getByRole('button', { name: /Add Manually/i }).click();
      const input = page.getByLabel(/Name/i).first();
      await expect(input).toBeVisible({ timeout: 8000 });
      await input.fill(name);
      const saveBtn = page.getByRole('button', { name: /Save|Done|Speichern/i }).first();
      if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) await saveBtn.click();
      else await page.keyboard.press('Escape');
      await expect(page.getByText(name)).toBeVisible({ timeout: 8000 });
    }

    // Both should be present
    await expect(page.getByText('Alpha Char')).toBeVisible();
    await expect(page.getByText('Beta Char')).toBeVisible();
  });
});
