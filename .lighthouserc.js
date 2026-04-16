export default {
  ci: {
    collect: {
      url: ['http://127.0.0.1:4173'],
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
        'categories:performance': ['error', { minScore: 0.9 }],
        'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'speed-index': ['error', { maxNumericValue: 3000 }],
        'total-blocking-time': ['error', { maxNumericValue: 150 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'first-meaningful-paint': ['error', { maxNumericValue: 2200 }],
        interactive: ['error', { maxNumericValue: 3000 }],
        'unused-javascript': ['warn', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
