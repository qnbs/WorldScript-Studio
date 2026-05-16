/// <reference types="vitest" />

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    // QNBS-v3: Fork-Worker-Timeouts unter Last/jsdom — Threads-Pool stabiler als forks bei wenigen Workern.
    pool: 'threads',
    maxWorkers: 1,
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'components/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml' }]],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'features/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
        'services/**/*.{ts,tsx}',
        'packages/*/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/mocks/**',
        '.storybook/',
        'src-tauri/',
        '**/*.stories.{ts,tsx}',
        '**/*.d.ts',
      ],
      // QNBS-v3: Phase-1-Schwellen nach 20+ neuen Testdateien erhöht; Ziel Phase-2: 50 %.
      thresholds: {
        lines: 35,
        functions: 30,
        branches: 22,
        statements: 33,
        perFile: false,
      },
    },
  },
});
