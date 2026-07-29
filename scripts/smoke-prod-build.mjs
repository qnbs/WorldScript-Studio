/**
 * Production-build smoke test.
 * QNBS-v3: The E2E suite runs against `vite dev` (esbuild, no DCE/minify), so prod-only
 *          rolldown bundling crashes ship green (e.g. the 2026-06-02 zod `init_locales is not
 *          defined` blank screen). This guard builds nothing itself — it serves the already-built
 *          `dist/` via `vite preview`, loads it in headless Chromium, and fails if React never
 *          mounts, any pageerror fires, a CSP violation is observed (console warning or
 *          `securitypolicyviolation` event — neither is a `pageerror`, see F-04 in
 *          docs/adr/0013-csp-wasm-and-blob-frames.md), or WebAssembly.instantiate is blocked by
 *          the deployed CSP. Wire AFTER `pnpm run build` in CI.
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
  // QNBS-v3: CSP violations fire as console warnings + `securitypolicyviolation` DOM events, never
  // `pageerror` — the pre-existing pageerror-only listener above was structurally blind to them
  // (F-04). Both are captured here so a blocked script/worker/frame fails this gate.
  const cspConsoleViolations = [];
  page.on('console', (msg) => {
    const text = msg.text();
    // QNBS-v3: "'frame-ancestors' is ignored when delivered via a <meta> element" is an expected,
    // permanent, non-blocking Chromium notice (frame-ancestors is a header-only directive by web
    // platform design — kept in the meta tag anyway for documentation/consistency, see ADR-0013).
    // Matching on "Content Security Policy" alone would false-positive on it forever; only actual
    // block/refusal phrasing counts as a violation here.
    const isRealBlock = /Refused to (load|execute|connect|frame)|violates the following/i.test(
      text,
    );
    const isKnownBenignNotice = /is ignored when delivered via/i.test(text);
    if (isRealBlock && !isKnownBenignNotice) {
      cspConsoleViolations.push(text);
    }
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations ??= [];
      window.__cspViolations.push({
        directive: e.effectiveDirective,
        blockedURI: e.blockedURI,
        sourceFile: e.sourceFile,
        lineNumber: e.lineNumber,
      });
    });
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
  const rawInPageCspViolations = await page.evaluate(() => window.__cspViolations ?? []);
  // QNBS-v3: zod v4's own JIT-availability probe (`new Function("")` inside a try/catch, used to
  // decide between compiled-validator fast paths and a jitless fallback) is a documented, harmless
  // `'unsafe-eval'`-classified CSP violation that zod already handles gracefully — it degrades to
  // jitless validation, nothing breaks. Enabling `'unsafe-eval'` to silence it is explicitly
  // forbidden (ADR-0013 §hard rules); this is the one intentional, narrowly-matched exception to
  // the "0 violations" bar, verified by tracing the exact blocked column back to zod's source
  // (`be.jitless||...;try{return new Function(""),!0}catch{return!1}`) during the 2026-07-29 audit.
  const isZodJitProbe = (v) => v.blockedURI === 'eval' && /\/assets\/zod-/.test(v.sourceFile ?? '');
  const inPageCspViolations = rawInPageCspViolations.filter((v) => !isZodJitProbe(v));
  const knownBenignViolations = rawInPageCspViolations.filter(isZodJitProbe);
  // QNBS-v3: static consistency tests (csp.test.ts) can't prove WASM actually runs under the
  // deployed policy — only a real browser instantiate call can (F-01).
  const wasmResult = await page.evaluate(async () => {
    try {
      const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
      await WebAssembly.instantiate(bytes);
      return true;
    } catch (e) {
      return `BLOCKED: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
  await browser.close();

  const totalCspViolations = cspConsoleViolations.length + inPageCspViolations.length;
  // eslint-disable-next-line no-console
  console.log(
    `[smoke] #root innerHTML length=${rootLen} pageerror=${pageError ?? 'none'} cspViolations=${totalCspViolations} (${knownBenignViolations.length} known-benign excluded) wasm=${wasmResult === true ? 'ok' : wasmResult}`,
  );
  if (knownBenignViolations.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[smoke] known-benign, not counted (zod JIT-probe, see comment above):');
    for (const v of knownBenignViolations) {
      // eslint-disable-next-line no-console
      console.log(
        `  [securitypolicyviolation] ${v.directive} blocked ${v.blockedURI} (${v.sourceFile}:${v.lineNumber})`,
      );
    }
  }
  if (totalCspViolations > 0) {
    // eslint-disable-next-line no-console
    console.error('[smoke] CSP violations detected:');
    for (const v of cspConsoleViolations) {
      // eslint-disable-next-line no-console
      console.error(`  [console] ${v}`);
    }
    for (const v of inPageCspViolations) {
      // eslint-disable-next-line no-console
      console.error(
        `  [securitypolicyviolation] ${v.directive} blocked ${v.blockedURI} (${v.sourceFile}:${v.lineNumber})`,
      );
    }
  }
  if (wasmResult !== true) {
    // eslint-disable-next-line no-console
    console.error(`[smoke] WebAssembly.instantiate blocked: ${wasmResult}`);
  }
  if (rootLen > 100 && !pageError && totalCspViolations === 0 && wasmResult === true) {
    // eslint-disable-next-line no-console
    console.log('[smoke] PASS — production build mounts, 0 CSP violations, wasm: ok ✅');
    exitCode = 0;
  } else {
    // eslint-disable-next-line no-console
    console.error('[smoke] FAIL — production build did not fully pass ❌');
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[smoke] ERROR:', err instanceof Error ? err.message : err);
} finally {
  preview?.kill('SIGTERM');
}
process.exit(exitCode);
