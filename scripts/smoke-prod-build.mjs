/**
 * Production-build smoke test.
 * QNBS-v3: The E2E suite runs against `vite dev` (esbuild, no DCE/minify), so prod-only
 *          rolldown bundling crashes ship green (e.g. the 2026-06-02 zod `init_locales is not
 *          defined` blank screen). This guard builds nothing itself — it serves the already-built
 *          `dist/` via `vite preview`, loads it in headless Chromium, and fails if React never
 *          mounts or any pageerror fires. Wire AFTER `pnpm run build` in CI.
 *
 * Usage: pnpm run build && node scripts/smoke-prod-build.mjs
 * Requires: a Chromium build (`pnpm exec playwright install chromium-headless-shell`).
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = Number(process.env['SMOKE_PORT'] ?? 4173);
const CANDIDATE_PATHS = ['/WorldScript-Studio/', '/'];

function startPreview() {
  const child = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
    { stdio: 'pipe' },
  );
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

/** Find the served base path by probing for the SPA index shell. */
async function resolveAppUrl() {
  for (let i = 0; i < 40; i++) {
    for (const p of CANDIDATE_PATHS) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}${p}`);
        if (res.ok) {
          const html = await res.text();
          if (html.includes('<div id="root">')) return `http://127.0.0.1:${PORT}${p}`;
        }
      } catch {
        /* server not up yet */
      }
    }
    await sleep(500);
  }
  return null;
}

let preview;
let exitCode = 1;
try {
  preview = startPreview();
  const url = await resolveAppUrl();
  if (!url) throw new Error('vite preview did not serve the app shell within timeout');
  // eslint-disable-next-line no-console
  console.log(`[smoke] serving prod build at ${url}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let pageError = null;
  page.on('pageerror', (e) => {
    if (!pageError) pageError = e.message;
  });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page
    .waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 100, {
      timeout: 15000,
    })
    .catch(() => {});
  const rootLen = await page.evaluate(
    () => document.getElementById('root')?.innerHTML.length ?? -1,
  );
  await browser.close();

  // eslint-disable-next-line no-console
  console.log(`[smoke] #root innerHTML length=${rootLen} pageerror=${pageError ?? 'none'}`);
  if (rootLen > 100 && !pageError) {
    // eslint-disable-next-line no-console
    console.log('[smoke] PASS — production build mounts ✅');
    exitCode = 0;
  } else {
    // eslint-disable-next-line no-console
    console.error('[smoke] FAIL — production build did not mount (blank screen) ❌');
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[smoke] ERROR:', err instanceof Error ? err.message : err);
} finally {
  preview?.kill('SIGTERM');
}
process.exit(exitCode);
