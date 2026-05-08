import type { Page } from '@playwright/test';

/**
 * Vite dev server keeps the HMR/WebSocket busy → `networkidle` often never settles.
 * Wait for either the welcome portal primary action or the desktop sidebar shell.
 */
export async function waitForSpaReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await Promise.race([
    page.locator('#sidebar').waitFor({ state: 'visible', timeout: 25000 }),
    page.locator('[data-tour="nav-mobile"]').waitFor({ state: 'visible', timeout: 25000 }),
    page
      .getByRole('button', { name: /Start a New Project/i })
      .waitFor({ state: 'visible', timeout: 25000 }),
  ]);
}

/**
 * Main shell is ready (desktop sidebar or mobile bottom tab bar).
 */
async function waitForMainChrome(page: Page): Promise<void> {
  await Promise.race([
    page.locator('#sidebar').waitFor({ state: 'visible', timeout: 25000 }),
    page.locator('[data-tour="nav-mobile"]').waitFor({ state: 'visible', timeout: 25000 }),
  ]);
}

/** Language toggle on the welcome portal (EN must be active for English copy in assertions). */
export async function selectEnglish(page: Page): Promise<void> {
  const enBtn = page.getByRole('button', { name: /^EN$/i }).first();
  if (await enBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await enBtn.click();
  }
}

/**
 * Exit WelcomePortal with a blank project so `#sidebar` and main views are reachable.
 */
export async function ensureBlankProject(page: Page): Promise<void> {
  await waitForSpaReady(page);
  const startBtn = page.getByRole('button', { name: /Start a New Project/i });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await startBtn.click();
    await page
      .getByRole('button', { name: /Blank Manuscript/i })
      .first()
      .click();
    await waitForMainChrome(page);
    return;
  }
  await waitForMainChrome(page);
}

/** Desktop sidebar (`md:`); avoids duplicate nav controls vs mobile tab bar. */
export function sidebar(page: Page) {
  return page.locator('#sidebar');
}
