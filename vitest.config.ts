/// <reference types="vitest" />

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'components/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml' }]],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'app/**/*.ts',
        'components/**/*.tsx',
        'features/**/*.ts',
        'hooks/**/*.ts',
        'services/**/*.ts',
      ],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '.storybook/',
        'src-tauri/',
        '**/*.stories.{ts,tsx}',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 15,
        functions: 20,
        branches: 15,
        statements: 15,
        perFile: false,
      },
    },
  },
});
