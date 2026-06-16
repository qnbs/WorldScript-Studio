import { defineConfig, devices } from '@playwright/test';

const isCi = process.env['CI'] === 'true';
const runMobileLocal = process.env['RUN_MOBILE_E2E'] === '1';

// QNBS-v3: P1-2 — fake-media flags so getUserMedia auto-grants a mic + a synthetic audio device.
//          Required by the voice deep specs (VoiceCommandService.initialize requests the mic) and
//          by the nightly real-inference suite (--use-file-for-fake-audio-capture can be added there).
const chromiumVoiceArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

const desktopChrome = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'], launchOptions: { args: chromiumVoiceArgs } },
};
const mobileChrome = {
  name: 'Mobile Chrome',
  use: { ...devices['Pixel 5'], launchOptions: { args: chromiumVoiceArgs } },
};

// QNBS-v3: CI = Desktop + Mobile Chromium (one browser install); locally mobile is optional via RUN_MOBILE_E2E=1 for low-end machines.
const e2eProjects = isCi
  ? [desktopChrome, mobileChrome]
  : [
      desktopChrome,
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      ...(runMobileLocal ? [mobileChrome] : []),
    ];

export default defineConfig({
  testDir: './tests/e2e',
  // QNBS-v3: deep/ specs run in a separate non-blocking CI job (e2e-deep) so they don't
  // add ~30 tests to the required e2e gate. Run locally with: pnpm run test:e2e:deep
  // RUN_DEEP_E2E=1 clears the ignore list so the e2e-deep job can discover deep/ specs.
  testIgnore: process.env['RUN_DEEP_E2E'] ? [] : ['**/deep/**'],
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
    baseURL: 'http://127.0.0.1:3000/WorldScript-Studio',
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
    // QNBS-v3: PLAYWRIGHT_REUSE_SERVER=true lets the VRT job pre-start http-server and reuse it
    reuseExistingServer: !process.env['CI'] || process.env['PLAYWRIGHT_REUSE_SERVER'] === 'true',
    timeout: 120_000,
  },
});
