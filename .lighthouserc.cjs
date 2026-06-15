// QNBS-v3: derive the audited URL from the same deploy-base logic the build/preview use
// (mirror of scripts/resolve-deploy-base.mjs — keep in sync). Hardcoding the GitHub Pages
// base made LHCI audit a 404 when the preview was built with VITE_BASE=/ or DEPLOY_TARGET=edge.
function resolveDeployBase() {
  const viteBase = process.env.VITE_BASE?.trim();
  if (viteBase) {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  if (process.env.DEPLOY_TARGET === 'edge') {
    return '/';
  }
  return '/WorldScript-Studio/';
}

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'pnpm run preview',
      startServerReadyPattern: 'Local',
      url: [`http://127.0.0.1:4173${resolveDeployBase()}`],
      numberOfRuns: 3,
      settings: {
        // QNBS-v3: harden Chrome launch on CI runners. `--disable-dev-shm-usage` is the fix for the
        // intermittent "Protocol error (Runtime.evaluate): Execution context was destroyed" flake —
        // GitHub runners have a tiny /dev/shm, so the renderer crashes mid-collect and aborts the
        // whole `lhci autorun` (numberOfRuns can't recover a crashed run). --no-sandbox/--disable-gpu
        // are standard headless-CI hygiene.
        chromeFlags: '--no-sandbox --disable-dev-shm-usage --disable-gpu',
        emulatedFormFactor: 'mobile',
        throttlingMethod: 'simulate',
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 732,
          deviceScaleFactor: 2,
          disabled: false,
        },
        formFactor: 'mobile',
      },
    },
    assert: {
      assertions: {
        // QNBS-v3: Accessibility promoted to error — WCAG 2.2 is enforced in code and axe-core E2E; this gate mirrors that commitment.
        // QNBS-v3: raised from 0.88 → 0.95 after fixing color-contrast in light theme and aria violations
        'categories:accessibility': ['error', { minScore: 0.95 }],
        // QNBS-v3: performance kept as warn — mobile headless CI emulation returns null score unreliably; not a stable error gate
        'categories:performance': ['warn', { minScore: 0.4 }],
        'categories:seo': ['warn', { minScore: 0.8 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 5000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 7000 }],
        'speed-index': ['warn', { maxNumericValue: 8000 }],
        'total-blocking-time': ['warn', { maxNumericValue: 600 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
