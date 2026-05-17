module.exports = {
  ci: {
    collect: {
      startServerCommand: 'pnpm run preview',
      startServerReadyPattern: 'Local',
      url: ['http://127.0.0.1:4173/StoryCraft-Studio/'],
      numberOfRuns: 3,
      settings: {
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
