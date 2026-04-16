import { test, expect, type Route } from '@playwright/test';

const isCI = process.env.CI === 'true';

const mockGemini = async (route: Route) => {
  const request = route.request();
  if (request.method() !== 'POST') {
    return route.continue();
  }

  const postData = request.postData() || '';
  const isJsonSchema = /responseMimeType|responseSchema/i.test(postData);
  const content = isJsonSchema
    ? JSON.stringify([
        {
          id: 'outline-1',
          title: 'Chapter One',
          description: 'A mysterious beginning that sets the stage.',
        },
        {
          id: 'outline-2',
          title: 'Chapter Two',
          description: 'The protagonist meets their first challenge.',
        },
      ])
    : 'OK';

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content }] }),
  });
};

test.describe('End-to-end project flow (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.route('**/generativelanguage.googleapis.com/**', mockGemini);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('full project flow navigates from AI outline to export and settings', async ({ page }) => {
    const englishButton = page.getByRole('button', { name: /EN/i }).first();
    if (await englishButton.isVisible()) {
      await englishButton.click();
    }

    await page.getByRole('button', { name: /Start a New Project/i }).click();
    await page.getByRole('button', { name: /Generate with AI/i }).click();

    await page.getByLabel(/Genre/i).fill('Fantasy');
    await page.getByLabel(/Prompt|Idea/i).fill('A reluctant hero discovers an ancient secret.');
    await page.getByRole('button', { name: /Generate Outline|Generiere Gliederung/i }).click();

    const applyButton = page.getByRole('button', {
      name: /Apply Outline to Manuscript|Apply Outline/i,
    });
    await expect(applyButton).toBeVisible({ timeout: 15000 });
    await applyButton.click();

    await page.getByRole('button', { name: /Writer|Schreiben/i }).click();
    const sectionSelect = page.getByRole('combobox').first();
    await expect(sectionSelect).toBeVisible();
    const firstValue = await sectionSelect
      .locator('option:not([disabled])')
      .first()
      .getAttribute('value');
    if (firstValue) {
      await sectionSelect.selectOption(firstValue);
    }

    const writerTextbox = page.getByRole('textbox').first();
    await expect(writerTextbox).toBeVisible();
    await writerTextbox.fill('The first chapter opens on a quiet village under a strange moon.');
    await expect(writerTextbox).toHaveValue(/quiet village under a strange moon/i);

    await page.getByRole('button', { name: /Export|Exportieren/i }).click();
    const manuscriptCheckbox = page.getByLabel(/Manuscript|Manuskript/i).first();
    if (await manuscriptCheckbox.isVisible()) {
      const isChecked = await manuscriptCheckbox.isChecked();
      if (!isChecked) {
        await manuscriptCheckbox.check();
      }
    }

    const previewHeading = page.getByRole('heading', { name: /Live Preview/i }).first();
    await expect(previewHeading).toBeVisible();
    const exportPreview = page.locator('pre').first();
    await expect(exportPreview).toContainText(/quiet village under a strange moon/i);
    await expect(exportPreview).toHaveScreenshot('export-preview.png');

    await page.getByRole('button', { name: /Settings|Einstellungen/i }).click();
    await page.getByRole('button', { name: /AI Configuration|AI Configuration/i }).click();
    await page
      .getByLabel(/Enter your Gemini API Key|Geben Sie Ihren Gemini API-Schlüssel ein/i)
      .fill('AIzaTestKey12345');
    await page.getByRole('button', { name: /Save Key|Save Key|Speichern/i }).click();
    await expect(page.getByText(/Configured|Konfiguriert/i)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /Dark/i }).click();
    await expect(page.locator('body')).toHaveClass(/dark-theme/);
  });
});
