export default {
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
        'categories:performance': ['warn', { minScore: 0.7 }],
        'first-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
        'speed-index': ['error', { maxNumericValue: 4500 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'first-meaningful-paint': ['error', { maxNumericValue: 3000 }],
        interactive: ['error', { maxNumericValue: 5000 }],
        'unused-javascript': ['warn', { minScore: 0.8 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
