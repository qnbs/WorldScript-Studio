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
        'app/hooks.ts',
        'app/utils.ts',
        'features/featureFlags/featureFlagsSlice.ts',
        'features/project/projectSlice.ts',
        'features/settings/settingsSlice.ts',
        'features/status/statusSlice.ts',
        'features/versionControl/versionControlSlice.ts',
        'features/writer/writerSlice.ts',
        'hooks/useConsistencyCheckerView.ts',
        'hooks/useCriticView.ts',
        'hooks/useHelpView.ts',
        'hooks/useTTS.ts',
        'hooks/useWriterView.ts',
        'services/aiUtils.ts',
        'services/collaborationService.ts',
        'services/dbService.ts',
        'services/epubApiService.ts',
        'services/geminiService.ts',
        'services/logger.ts',
        'components/HelpView.tsx',
        'components/ui/Button.tsx',
        'components/ui/Card.tsx',
        'components/ui/Input.tsx',
        'components/ui/Modal.tsx',
        'components/ui/Spinner.tsx',
      ],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '.storybook/',
        'src-tauri/',
        '**/*.stories.{ts,tsx}',
      ],
      thresholds: {
        lines: 35,
        functions: 40,
        branches: 30,
        statements: 35,
        perFile: false,
      },
    },
  },
});
