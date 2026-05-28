/// <reference types="vitest" />

import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // QNBS-v3: Map optional ai-core peer deps so workers/ and services/ can import them in tests.
  resolve: {
    alias: {
      '@xenova/transformers': path.resolve(
        './packages/ai-core/node_modules/@xenova/transformers/src/transformers.js',
      ),
      // QNBS-v3: B-3 vendor fork — resolve workspace package in tests
      '@domain/collab-transport': path.resolve('./packages/collab-transport/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    // QNBS-v3: maxWorkers:1 + single test-run avoids RAM exhaustion on the low-end dev machine.
    //          Run pnpm exec vitest run as ONE sequential process — never concurrently with other
    //          heavy commands.  isolate:true (default) keeps module state clean between files.
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
      // QNBS-v3: Phase 1 (ProForge pipeline agents) — raised after 109 new agent tests.
      thresholds: {
        lines: 68,
        functions: 60,
        branches: 55,
        statements: 67,
        perFile: false,
      },
    },
  },
});
