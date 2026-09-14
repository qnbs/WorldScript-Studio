/**
 * E2E: Browser-Ollama admission and privacy boundary (#711 / ADR-0017).
 *
 * The route stub keeps required CI independent of a host Ollama daemon. These tests qualify the
 * product admission contract (OFF is network-inert; ON requires explicit user actions), while
 * real Ollama/runtime qualification remains a separate #743 release-gate evidence step.
 */
import { expect, test } from '@playwright/test';

import {
  clickNavItem,
  ensureBlankProject,
  selectEnglish,
  setFeatureFlags,
  waitForSpaReady,
} from './helpers';

const isCI = process.env['CI'] === 'true';
const ollamaTagsUrl = 'http://localhost:11434/api/tags';

function trackOllamaRequests(page: import('@playwright/test').Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin === 'http://localhost:11434') {
      requests.push(request.url());
    }
  });
  return requests;
}

async function stubOllamaTags(page: import('@playwright/test').Page): Promise<void> {
  await page.route('http://localhost:11434/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }),
    });
  });
}

async function openOllamaProvider(page: import('@playwright/test').Page): Promise<void> {
  await clickNavItem(page, /Settings/i);
  await page.getByTestId('settings-nav-ai').click();
  await page.getByRole('button', { name: 'Ollama (local)', exact: true }).click();
}

test.describe('Browser-Ollama admission (ADR-0017)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isCI, 'CI-only E2E suite');
    await setFeatureFlags(page, { enableBrowserOllama: false });
    await page.goto('/');
    await waitForSpaReady(page);
    await selectEnglish(page);
    await ensureBlankProject(page);
  });

  test('flag off stays network-inert and blocks local-server actions', async ({ page }) => {
    const ollamaRequests = trackOllamaRequests(page);
    await stubOllamaTags(page);
    await openOllamaProvider(page);

    await expect(page.getByText('Desktop app required for local servers')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load models', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeDisabled();
    expect(ollamaRequests).toEqual([]);
  });

  test('explicit opt-in enables the browser path, but only explicit actions request Ollama', async ({
    page,
  }) => {
    const ollamaRequests = trackOllamaRequests(page);
    await stubOllamaTags(page);

    await clickNavItem(page, /Settings/i);
    await page.getByTestId('settings-nav-experimental').click();
    const optIn = page.getByRole('switch', {
      name: 'Browser-Ollama connection (experimental, unsupported)',
    });
    await expect(optIn).toHaveAttribute('aria-checked', 'false');
    await optIn.click();
    await expect(optIn).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const stored = localStorage.getItem('worldscript-feature-flags');
          if (!stored) return undefined;
          return (JSON.parse(stored) as { enableBrowserOllama?: boolean }).enableBrowserOllama;
        }),
      )
      .toBe(true);

    await page.getByTestId('settings-nav-ai').click();
    await page.getByRole('button', { name: 'Ollama (local)', exact: true }).click();
    await expect(
      page.getByText('Browser connection enabled (advanced, unsupported)'),
    ).toBeVisible();
    expect(ollamaRequests).toEqual([]);

    await page.getByRole('button', { name: 'Load models', exact: true }).click();
    await expect(page.getByRole('button', { name: 'qwen3:8b', exact: true })).toBeVisible();
    expect(ollamaRequests).toEqual([ollamaTagsUrl]);

    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect.poll(() => ollamaRequests.length).toBe(2);
  });
});
