// Evidence (never merged, #716): the default config, served from the production build instead of the dev server.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 3000 --strictPort',
    url: 'http://127.0.0.1:3000/WorldScript-Studio/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
