import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// QNBS-v3: clickNavItem — sidebar(page) targets #sidebar which is hidden md:flex; fails on Mobile Chrome (Pixel 5)
/**
 * Mobile-aware navigation: tries desktop sidebar → mobile tab bar → mobile "More" sheet.
 */
export async function clickNavItem(page: Page, name: RegExp): Promise<void> {
  // 1. Desktop sidebar (md+ viewports) — #sidebar is hidden md:flex, visible only on desktop
  const desktopBtn = page.locator('#sidebar').getByRole('button', { name });
  if (await desktopBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await desktopBtn.click();
    return;
  }
  // 2. Mobile bottom tab bar (dashboard / manuscript / writer / sceneboard)
  const mobileTabBtn = page.locator('[data-tour="nav-mobile"]').getByRole('button', { name });
  if (await mobileTabBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await mobileTabBtn.click();
    return;
  }
  // 3. Mobile "More" sheet (Settings, Outline, Export… not in the 5-item tab bar)
  await page.locator('[data-tour="nav-mobile"]').getByRole('button', { name: /More/i }).click();
  await page.locator('#sidebar-mobile').waitFor({ state: 'visible' });
  await page.locator('#sidebar-mobile').getByRole('button', { name }).click();
}

// QNBS-v3: Stable Writer `#writer-section-select` + option handling avoids Playwright strict-mode / native-<option> visibility pitfalls that broke CI E2E.

/** Writer section `<Select>` — stable id to avoid picking tone/tool comboboxes elsewhere on the page. */
export function writerSectionSelect(page: Page) {
  // QNBS-v3: ContextPanel exists in both mobile tab panel and always-rendered desktop grid (hidden
  // md:grid); first() picks the mobile-panel instance when context tab is active (it is first in DOM
  // order), and the sole desktop instance otherwise — prevents strict-mode violation from duplicate IDs.
  return page.locator('#writer-section-select').first();
}

/**
 * QNBS-v3: Select is now a custom dropdown (button + listbox), not native <select>.
 * Click trigger to open dropdown, then click first enabled option.
 */
export async function selectFirstEnabledWriterSection(page: Page): Promise<void> {
  // Writer view is lazy-loaded; wait for writer-tab-context to attach before checking
  // viewport visibility — 2s was too short for CI Mobile Chrome with a cold bundle load.
  const contextTab = page.getByTestId('writer-tab-context');
  await contextTab.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
  let sel: import('@playwright/test').Locator;
  // md:hidden means visible on <768px (mobile) and hidden on ≥768px (desktop)
  if (await contextTab.isVisible({ timeout: 500 }).catch(() => false)) {
    if ((await contextTab.getAttribute('aria-selected')) !== 'true') {
      await contextTab.click();
    }
    // After clicking context tab on mobile, ContextPanel renders in BOTH the mobile tab panel
    // (#writer-panel-context, visible) and the always-rendered desktop grid (hidden md:grid, display:none).
    // Wait for the mobile panel to mount, then scope the select to it to avoid picking the hidden one.
    await page.locator('#writer-panel-context').waitFor({ state: 'visible' });
    sel = page.locator('#writer-panel-context #writer-section-select');
  } else {
    sel = writerSectionSelect(page);
  }
  await expect(sel).toBeVisible();

  // QNBS-v3: Select is a custom dropdown (button + listbox), not native <select>.
  // Click trigger to open dropdown, then select first enabled option.
  await sel.click();
  const container = sel.locator('xpath=..');
  const listbox = container.locator('[role="listbox"]');
  await expect(listbox).toBeVisible({ timeout: 5000 });
  const options = listbox.locator('[role="option"]:not([disabled])');
  await expect.poll(async () => options.count()).toBeGreaterThan(0);
  // Use direct DOM click to avoid "subtree intercepts pointer events" when
  // the dropdown is overlapped by other elements (e.g. textarea in Writer view).
  await options.first().evaluate((el) => (el as HTMLElement).click());
}

/** Outline / AI flows call Gemini only when a key exists in encrypted storage — seed before mocked HTTP in CI. */
/** DebouncedTextarea notifies Redux after ~750ms — flush before leaving Writer or export previews stay stale in CI. */
export async function flushWriterDebounce(page: Page): Promise<void> {
  await page.waitForTimeout(850);
}

export async function seedGeminiApiKey(page: Page): Promise<void> {
  // QNBS-v3: clickNavItem — sidebar(page) is hidden md:flex, fails on Mobile Chrome
  await clickNavItem(page, /Settings/i);
  // QNBS-v3: .first() — SettingsOverviewCard also renders an AI Configuration quick-access button
  await page
    .getByRole('button', { name: /AI Configuration|KI-Konfiguration/i })
    .first()
    .click();
  await page
    .getByLabel(/Enter your Gemini API Key|Geben Sie Ihren Gemini API-Schlüssel ein/i)
    .fill('AIzaTestKey123456789012345678901234');
  await page.getByRole('button', { name: /Save Key|Speichern/i }).click();
  await expect(page.getByText(/Configured|Konfiguriert/i)).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  // QNBS-v3: default localStorageOnly:true blocks cloud AI — must disable so Gemini calls go through.
  //          ToggleSwitch uses role="switch" (not "checkbox") — wrong role means the locator never finds it.
  await page.getByRole('button', { name: /Privacy & Security/i }).click();
  const localOnlyToggle = page.getByRole('switch', { name: /Local Storage Only/i });
  const isOn = await localOnlyToggle.getAttribute('aria-checked').catch(() => null);
  if (isOn === 'true') {
    await localOnlyToggle.click();
  }
}

/**
 * Vite dev server keeps the HMR/WebSocket busy → `networkidle` often never settles.
 * Wait for either the welcome portal primary action or the desktop sidebar shell.
 * QNBS-v3: Also waits for the body theme class to be applied by the App useEffect so
 *          that CSS custom properties (--sc-text-primary, etc.) are fully resolved before
 *          axe or visual checks run — without this, variables resolve to intermediate values.
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
  // QNBS-v3: theme class is applied in App useEffect after first render — wait for it so
  //          CSS variable values are stable (avoids axe false-positives on mid-transition colors).
  //          appearance-sepia stacks with light-theme/dark-theme, not a standalone class.
  await page
    .waitForFunction(
      () =>
        document.body.classList.contains('light-theme') ||
        document.body.classList.contains('dark-theme'),
      { timeout: 5000 },
    )
    .catch(() => {}); // best-effort: if no theme class, continue anyway
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

/**
 * Seed feature-flag overrides into localStorage so the Redux slice picks them up on init.
 *
 * MUST be called BEFORE page.goto() — uses addInitScript so it runs before any app JS.
 * Only the specified keys are overridden; all other flags keep their slice defaults.
 * The storage key is 'storycraft-feature-flags' (mirrors featureFlagsSlice.ts).
 *
 * Example:
 *   await setFeatureFlags(page, { enableProForge: true });
 *   await page.goto('/');
 */
export async function setFeatureFlags(
  page: Page,
  flags: Partial<Record<string, boolean>>,
): Promise<void> {
  await page.addInitScript((overrides) => {
    try {
      const stored = localStorage.getItem('storycraft-feature-flags');
      const existing: Record<string, boolean> = stored
        ? (JSON.parse(stored) as Record<string, boolean>)
        : {};
      localStorage.setItem(
        'storycraft-feature-flags',
        JSON.stringify({ ...existing, ...overrides }),
      );
    } catch {
      /* storage unavailable — slice falls back to defaults */
    }
  }, flags);
}
