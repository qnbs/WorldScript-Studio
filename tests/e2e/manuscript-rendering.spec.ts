/**
 * QNBS-v3 (#341): ManuscriptEditor.tsx shares the real-textarea-over-mirror pattern and defects with Writer Studio's ContextPanel.tsx; this spec exercises the primary manuscript surface independent of writer.spec.ts.
 */
import { expect, test } from '@playwright/test';

import { readRenderedTextReadability } from './editorReadability';
import {
  clickNavItem,
  ensureBlankProject,
  flushWriterDebounce,
  selectEnglish,
  selectFirstEnabledWriterSection,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('Manuscript editor rendering (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
  });

  test('Manuscript text is visually readable and stays in scroll sync (#341)', async ({ page }) => {
    await selectEnglish(page);
    await ensureBlankProject(page);

    // QNBS-v3: seed section content via Writer Studio (the established, reliable content-entry path) before switching to the Manuscript view to check its own rendering.
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    await selectFirstEnabledWriterSection(page);
    const writerTextbox = page.getByTestId('writer-studio-editor').first();
    await expect(writerTextbox).toBeVisible();
    const longContent = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog.`,
    ).join('\n\n');
    await writerTextbox.fill(longContent);
    await flushWriterDebounce(page);

    await clickNavItem(page, /Manuscript/i);
    const manuscriptTextbox = page.getByTestId('manuscript-editor-textarea').first();
    await expect(manuscriptTextbox).toBeVisible();
    await expect(manuscriptTextbox).toHaveValue(/Paragraph 1/i);

    const mirror = page.getByTestId('manuscript-editor-mirror').first();
    await expect(mirror).toBeVisible();
    await expect(mirror).toContainText('Paragraph 1: the quick brown fox jumps over the lazy dog.');

    const backdropFilter = await manuscriptTextbox.evaluate(
      (el) => getComputedStyle(el).backdropFilter,
    );
    expect(backdropFilter === 'none' || backdropFilter === '').toBeTruthy();

    const readability = await readRenderedTextReadability(mirror);
    expect(readability).not.toBeNull();
    expect(readability?.ratio ?? 0).toBeGreaterThanOrEqual(4.5);

    await manuscriptTextbox.evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.scrollTop = 200;
      textarea.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(async () => mirror.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const [textareaScroll, mirrorScroll] = await Promise.all([
      manuscriptTextbox.evaluate((el) => (el as HTMLTextAreaElement).scrollTop),
      mirror.evaluate((el) => el.scrollTop),
    ]);
    expect(Math.abs(textareaScroll - mirrorScroll)).toBeLessThanOrEqual(2);
  });
});