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
        'categories:performance': ['warn', { minScore: 0.5 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 6000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 8000 }],
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
