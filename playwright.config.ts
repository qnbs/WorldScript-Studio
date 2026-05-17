import { defineConfig, devices } from '@playwright/test';

const isCi = process.env['CI'] === 'true';
const runMobileLocal = process.env['RUN_MOBILE_E2E'] === '1';

const desktopChrome = { name: 'chromium', use: { ...devices['Desktop Chrome'] } };
const mobileChrome = { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } };

// QNBS-v3: CI = Desktop + Mobile Chromium (ein Browser-Install); lokal optional Mobile nur mit RUN_MOBILE_E2E=1 für Low-End-Rechner.
const e2eProjects = isCi
  ? [desktopChrome, mobileChrome]
  : [
      desktopChrome,
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      ...(runMobileLocal ? [mobileChrome] : []),
    ];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : 4,
  reporter: [
    ['html', { outputFolder: 'tests/e2e/html-report' }],
    ['junit', { outputFile: 'tests/e2e/results/junit.xml' }],
  ],

  /** Omit `{platform}` so one baseline PNG works on Linux (CI) and Windows/macOS dev machines. */
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',

  // QNBS-v3: explicit per-test timeout so a hung test fails fast instead of
  // burning the remaining GitHub Actions budget (job was exceeding 30 min).
  timeout: 60_000,

  expect: {
    timeout: 30_000,
  },

  use: {
    baseURL: 'http://127.0.0.1:3000/StoryCraft-Studio',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // QNBS-v3: action + navigation timeouts bound to detect UI hangs / stalled
    // Vite HMR/WebSocket loads that would otherwise silently eat all retries.
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
  },

  projects: e2eProjects,

  webServer: {
    command: 'pnpm run dev -- --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
