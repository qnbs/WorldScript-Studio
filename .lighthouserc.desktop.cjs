// QNBS-v3: Desktop Lighthouse config — runs alongside the mobile config (.lighthouserc.cjs).
// Serves production dist (pnpm run preview) and audits with desktop emulation.
// continue-on-error: true in ci.yml until desktop baselines stabilise.
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
      numberOfRuns: 2,
      settings: {
        // QNBS-v3: same /dev/shm crash hardening as the mobile config (.lighthouserc.cjs) —
        // --disable-dev-shm-usage prevents the "Execution context was destroyed" CI flake.
        chromeFlags: '--no-sandbox --disable-dev-shm-usage --disable-gpu',
        preset: 'desktop',
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      assertions: {
        // QNBS-v3: Accessibility is an error gate on desktop too — mirrors mobile + axe-core E2E commitment.
        'categories:accessibility': ['error', { minScore: 0.95 }],
        // QNBS-v3: Desktop performance bar is higher than mobile (no throttling penalty).
        'categories:performance': ['warn', { minScore: 0.7 }],
        'categories:seo': ['warn', { minScore: 0.8 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 3000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 5000 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
