import { expect, type Route, test } from '@playwright/test';

import {
  flushWriterDebounce,
  seedGeminiApiKey,
  selectFirstEnabledWriterSection,
  sidebar,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';

const mockGemini = async (route: Route) => {
  const request = route.request();
  if (request.method() !== 'POST') {
    return route.continue();
  }

  const postData = request.postData() || '';
  const isJsonSchema = /responseMimeType|responseSchema/i.test(postData);
  const textPart = isJsonSchema
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

  // QNBS-v3: @google/genai SDK reads aggregated text from candidates[].content.parts[].text — flat `content` breaks outline JSON parsing in CI.
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: textPart }] },
          finishReason: 'STOP',
        },
      ],
    }),
  });
};

test.describe('End-to-end project flow (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.route('**/generativelanguage.googleapis.com/**', mockGemini);
    await page.goto('/');
    await waitForSpaReady(page);
  });

  test('full project flow navigates from AI outline to export and settings', async ({ page }) => {
    const englishButton = page.getByRole('button', { name: /EN/i }).first();
    if (await englishButton.isVisible()) {
      await englishButton.click();
    }

    await page.getByRole('button', { name: /Start a New Project/i }).click();
    await page.getByRole('button', { name: /Generate with AI/i }).click();

    await seedGeminiApiKey(page);
    await sidebar(page)
      .getByRole('button', { name: /Outline Generator/i })
      .click();

    await page.getByLabel(/Genre/i).fill('Fantasy');
    await page.getByLabel(/Prompt|Idea/i).fill('A reluctant hero discovers an ancient secret.');
    await page.getByRole('button', { name: /Generate Outline|Generiere Gliederung/i }).click();

    const applyButton = page.getByRole('button', {
      name: /Apply Outline to Manuscript|Apply Outline/i,
    });
    await expect(applyButton).toBeVisible({ timeout: 15000 });
    await applyButton.click();

    await page.getByRole('button', { name: /AI Writing Studio|Writer|Schreiben/i }).click();
    await selectFirstEnabledWriterSection(page);

    const writerTextbox = page.getByTestId('writer-studio-editor');
    await expect(writerTextbox).toBeVisible();
    await writerTextbox.fill('The first chapter opens on a quiet village under a strange moon.');
    await expect(writerTextbox).toHaveValue(/quiet village under a strange moon/i);
    await flushWriterDebounce(page);

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

    await page.getByRole('button', { name: /Settings|Einstellungen/i }).click();
    await page.getByRole('button', { name: /AI Configuration|KI-Konfiguration/i }).click();
    // QNBS-v3: Nach seedGeminiApiKey zeigt ApiKeySection nur „configured“ — Input fehlt; nur füllen wenn noch kein Key.
    const geminiInput = page.locator('#gemini-api-key');
    if (await geminiInput.isVisible({ timeout: 2500 }).catch(() => false)) {
      await geminiInput.fill('AIzaTestKey12345');
      await page.getByRole('button', { name: /Save Key|Speichern/i }).click();
    }
    await expect(page.getByText(/API Key Configured|Konfiguriert/i).first()).toBeVisible({
      timeout: 15000,
    });

    // QNBS-v3: Theme-Buttons stehen in AppearanceSection — bei aktiver AI-Kategorie sind sie nicht im DOM.
    await page.getByRole('button', { name: /Appearance|Erscheinungsbild/i }).click();
    await page.getByRole('button', { name: /Dark|Dunkel/i }).click();
    await expect(page.locator('body')).toHaveClass(/dark-theme/);
  });
});
