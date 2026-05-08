import { defineConfig, devices } from '@playwright/test';

const isCi = process.env['CI'] === 'true';

/** CI installs Chromium only (`playwright install --with-deps chromium`); local dev may run Firefox too. */
const e2eProjects = isCi
  ? [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
  : [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
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

  expect: {
    timeout: 30_000,
  },

  use: {
    baseURL: 'http://127.0.0.1:3000/StoryCraft-Studio',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: e2eProjects,

  webServer: {
    command: 'pnpm run dev -- --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
