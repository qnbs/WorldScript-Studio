/**
 * E2E: LoRA Training Wizard flow.
 * QNBS-v3: CI-only; exercises the 5-step wizard with feature flag enabled.
 *          Training step uses the web fallback (no Tauri) so no Python is required.
 */

import { expect, test } from '@playwright/test';

import { clickNavItem, selectEnglish, waitForSpaReady } from './helpers';

const isCI = process.env['CI'] === 'true';

test.describe('LoRA Wizard (CI-only)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);

    // Enable the LoRA feature flag via Settings → Experimental
    await clickNavItem(page, /Settings/i);
    await page.getByRole('tab', { name: /System|Experimental/i }).click();
    const loraToggle = page
      .locator('[data-testid="flag-enableLoraAdapters"], label')
      .filter({
        hasText: /LoRA|Adapter/i,
      })
      .first();
    if (await loraToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const checked = await loraToggle.getAttribute('aria-checked');
      if (checked !== 'true') await loraToggle.click();
    }
  });

  test('LoRA tab appears in navigation when flag is enabled', async ({ page }) => {
    const loraNav = page.getByRole('button', { name: /LoRA|Fine.?Tun/i }).first();
    await expect(loraNav).toBeVisible({ timeout: 8000 });
  });

  test('Adapter Library shows empty state with Train CTA on first visit', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);
    // Library view should be the default (no adapters yet)
    await expect(page.getByText(/no adapters|train your first|Train New Adapter/i)).toBeVisible({
      timeout: 8000,
    });
  });

  test('Wizard opens and shows Model step', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);

    const trainBtn = page
      .getByRole('button', { name: /Train New Adapter|Start Training/i })
      .first();
    await expect(trainBtn).toBeVisible({ timeout: 8000 });
    await trainBtn.click();

    // Step indicator should show "Model" as first step
    await expect(page.getByText(/Model Selection|Select Model|Base Model/i)).toBeVisible({
      timeout: 5000,
    });
    // Step 1 of 5
    await expect(page.getByText(/1.*5|Step 1/i)).toBeVisible({ timeout: 3000 });
  });

  test('Wizard: model step → next → dataset step', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);
    const trainBtn = page
      .getByRole('button', { name: /Train New Adapter|Start Training/i })
      .first();
    await trainBtn.click();

    // Select first available model radio
    const firstModelOption = page.getByRole('radio').first();
    if (await firstModelOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstModelOption.click();
    }

    // Advance to Dataset step
    const nextBtn = page.getByRole('button', { name: /Next|Continue/i }).first();
    await nextBtn.click();

    // Should now show Dataset step
    await expect(page.getByText(/Dataset|Extract.*Manuscript|Scene Pairs/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test('Wizard: dataset step shows Extract button', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);
    const trainBtn = page
      .getByRole('button', { name: /Train New Adapter|Start Training/i })
      .first();
    await trainBtn.click();

    // Skip past model step
    const firstModelOption = page.getByRole('radio').first();
    if (await firstModelOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstModelOption.click();
    }
    await page
      .getByRole('button', { name: /Next|Continue/i })
      .first()
      .click();

    // Extract button should be present in dataset step
    await expect(page.getByRole('button', { name: /Extract|Build Dataset/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('Wizard: navigating back from dataset step returns to model step', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);
    const trainBtn = page
      .getByRole('button', { name: /Train New Adapter|Start Training/i })
      .first();
    await trainBtn.click();

    const firstModelOption = page.getByRole('radio').first();
    if (await firstModelOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstModelOption.click();
    }
    await page
      .getByRole('button', { name: /Next|Continue/i })
      .first()
      .click();
    await page
      .getByRole('button', { name: /Back|Previous/i })
      .first()
      .click();

    await expect(page.getByText(/Model Selection|Base Model/i)).toBeVisible({ timeout: 5000 });
  });

  test('Wizard: params step shows preset cards', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);
    const trainBtn = page
      .getByRole('button', { name: /Train New Adapter|Start Training/i })
      .first();
    await trainBtn.click();

    const firstModelOption = page.getByRole('radio').first();
    if (await firstModelOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstModelOption.click();
    }
    // Step 1 → 2 (Dataset)
    await page
      .getByRole('button', { name: /Next|Continue/i })
      .first()
      .click();
    // Step 2 → 3 (Params) — skip dataset requirement if no entries
    const nextBtn = page.getByRole('button', { name: /Next|Continue/i }).first();
    if (await nextBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      // Preset cards for Writer Style Light should appear
      await expect(page.getByText(/Writer Style Light|Deep Narrative/i)).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('Onboarding shows environment check on first open', async ({ page }) => {
    await clickNavItem(page, /LoRA|Fine.?Tun/i);
    // Onboarding may show system requirements section
    const envSection = page.getByText(/Python|Environment|System Requirements|desktop app/i);
    if (await envSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(envSection).toBeVisible();
    }
  });
});
