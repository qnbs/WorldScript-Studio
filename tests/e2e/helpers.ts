import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// QNBS-v3: Stable Writer `#writer-section-select` + option handling avoids Playwright strict-mode / native-<option> visibility pitfalls that broke CI E2E.

/** Writer section `<Select>` — stable id to avoid picking tone/tool comboboxes elsewhere on the page. */
export function writerSectionSelect(page: Page) {
  return page.locator('#writer-section-select');
}

/**
 * Native `<option>` nodes are not Playwright-visible when the list is closed; use counts + selectOption.
 */
export async function selectFirstEnabledWriterSection(page: Page): Promise<void> {
  const sel = writerSectionSelect(page);
  await expect(sel).toBeVisible();
  const enabled = sel.locator('option:not([disabled])');
  await expect.poll(async () => enabled.count()).toBeGreaterThan(0);
  const value = await enabled.first().getAttribute('value');
  if (value) await sel.selectOption(value);
}

/** Outline / AI flows call Gemini only when a key exists in encrypted storage — seed before mocked HTTP in CI. */
/** DebouncedTextarea notifies Redux after ~750ms — flush before leaving Writer or export previews stay stale in CI. */
export async function flushWriterDebounce(page: Page): Promise<void> {
  await page.waitForTimeout(850);
}

export async function seedGeminiApiKey(page: Page): Promise<void> {
  await sidebar(page)
    .getByRole('button', { name: /Settings/i })
    .click();
  await page.getByRole('button', { name: /AI Configuration|KI-Konfiguration/i }).click();
  await page
    .getByLabel(/Enter your Gemini API Key|Geben Sie Ihren Gemini API-Schlüssel ein/i)
    .fill('AIzaTestKey123456789012345678901234');
  await page.getByRole('button', { name: /Save Key|Speichern/i }).click();
  await expect(page.getByText(/Configured|Konfiguriert/i)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
}

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
