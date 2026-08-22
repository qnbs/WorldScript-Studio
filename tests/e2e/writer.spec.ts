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

test.describe('AI Writer Flow (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
  });

  test('app renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('service worker') &&
        !e.includes('ServiceWorker') &&
        !e.includes('sw.js') &&
        // Dev/HMR can surface SVG namespace warnings when icons mount during route transitions; tracked separately from app logic errors.
        !e.includes('The tag <path> is unrecognized'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('Writer view can be reached and edited', async ({ page }) => {
    await selectEnglish(page);
    await ensureBlankProject(page);
    // QNBS-v3: clickNavItem — sidebar(page) fails on Mobile Chrome; use mobile-aware helper
    await clickNavItem(page, /AI Writing Studio|Writer/i);
    // QNBS-v3: waitForURL('**/') is a no-op in this SPA (URL never changes) and can cause timing
    // issues on Mobile Chrome; removed in favour of selectFirstEnabledWriterSection's own wait.

    await selectFirstEnabledWriterSection(page);

    // QNBS-v3: WriterViewUI renders ContextPanel in both mobile tab-panel and desktop grid;
    // use .first() so strict mode is not violated (mobile panel is first in DOM when active).
    const writerTextbox = page.getByTestId('writer-studio-editor').first();
    await expect(writerTextbox).toBeVisible();
    await writerTextbox.fill('This is the first AI-assisted draft paragraph.');
    await expect(writerTextbox).toHaveValue(/first AI-assisted draft paragraph/i);
    await flushWriterDebounce(page);
  });

  // QNBS-v3 (#341): the real textarea sits invisibly over a visible text-mirror layer — a regression here previously left the mirror unreadable (backdrop-blur bleeding through) and scroll-desynced.
  test('Writer Studio text is visually readable and stays in scroll sync (#341)', async ({
    page,
  }) => {
    await selectEnglish(page);
    await ensureBlankProject(page);
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

    const mirror = page.getByTestId('writer-studio-mirror').first();
    await expect(mirror).toBeVisible();
    await expect(mirror).toContainText('Paragraph 1: the quick brown fox jumps over the lazy dog.');

    // The real (invisible) input textarea must never blur the mirror text sitting behind it.
    const backdropFilter = await writerTextbox.evaluate(
      (el) => getComputedStyle(el).backdropFilter,
    );
    expect(backdropFilter === 'none' || backdropFilter === '').toBeTruthy();

    const readability = await readRenderedTextReadability(mirror);
    expect(readability).not.toBeNull();
    expect(readability?.ratio ?? 0).toBeGreaterThanOrEqual(4.5);

    // Scroll parity: scrolling the real textarea must move the mirror by the same amount.
    await writerTextbox.evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.scrollTop = 200;
      textarea.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(async () => mirror.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const [textareaScroll, mirrorScroll] = await Promise.all([
      writerTextbox.evaluate((el) => (el as HTMLTextAreaElement).scrollTop),
      mirror.evaluate((el) => el.scrollTop),
    ]);
    expect(Math.abs(textareaScroll - mirrorScroll)).toBeLessThanOrEqual(2);
  });

  test('keyboard navigation and responsive layout work', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('body')).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await waitForSpaReady(page);
    await expect(page.locator('body')).toBeVisible();
  });
});