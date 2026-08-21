import { mutationFiles } from './scripts/stryker-scope.mjs';

// QNBS-v3: Share the validated risk-based mutation configuration between local tooling and CI.
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    related: true,
  },
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  plugins: ['@stryker-mutator/vitest-runner'],
  checkers: [],
  mutate: mutationFiles,
  thresholds: {
    high: 85,
    low: 70,
    break: 75,
  },
  reporters: ['progress', 'json', 'html'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  timeoutMS: 60000,
  timeoutFactor: 2.0,
  concurrency: 2,
  tempDirName: '.stryker-tmp',
  warnings: {
    slow: true,
  },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/playwright-report/**',
    '**/storybook-static/**',
  ],
};
