// Throwaway evidence script, lives only on an evidence branch and is never merged.
// It drives the INSTALLED packaged app on Windows through the WebView2 remote debugging port.
// Usage: node roundtrip.mjs <seed|verify|absent> <outDir> <token> [--append <token2>] [--seed-json <path>] [--expect <a,b>] [--port <n>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const [phase, outDir, token] = args;
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const port = flag('--port') ?? '9222';
mkdirSync(outDir, { recursive: true });
const log = (message) => process.stdout.write(`[${phase}] ${message}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const consoleErrors = [];

async function connect() {
  const deadline = Date.now() + 150000;
  let lastError = 'none';
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
      for (let attempt = 0; attempt < 60; attempt++) {
        const page = browser.contexts().flatMap((context) => context.pages())[0];
        if (page) return { browser, page };
        await sleep(500);
      }
      await browser.close();
      lastError = 'connected but no page';
    } catch (error) {
      lastError = String(error).slice(0, 300);
    }
    await sleep(2000);
  }
  throw new Error(`no debugging endpoint on port ${port}: ${lastError}`);
}

async function waitForShell(page) {
  await page.waitForLoadState('domcontentloaded');
  await Promise.race([
    page.locator('#sidebar').waitFor({ state: 'visible', timeout: 90000 }),
    page.getByTestId('welcome-portal').waitFor({ state: 'visible', timeout: 90000 }),
  ]);
}

const startupState = async (page) =>
  (await page
    .getByTestId('welcome-portal')
    .isVisible()
    .catch(() => false))
    ? 'WELCOME_PORTAL'
    : 'MAIN_CHROME';

async function createBlankProject(page) {
  const english = page.getByRole('button', { name: /^EN$/i }).first();
  if (await english.isVisible({ timeout: 3000 }).catch(() => false)) await english.click();
  await page.getByRole('button', { name: /Start a New Project/i }).click({ timeout: 20000 });
  await page
    .getByRole('button', { name: /Blank Manuscript/i })
    .first()
    .click({ timeout: 20000 });
  await page.locator('#sidebar').waitFor({ state: 'visible', timeout: 60000 });
}

async function openWriterEditor(page) {
  await page
    .locator('#sidebar')
    .getByRole('button', { name: /AI Writing Studio|Writer/i })
    .first()
    .click({ timeout: 30000 });
  const select = page.locator('#writer-section-select').first();
  await select.waitFor({ state: 'visible', timeout: 60000 });
  await select.click();
  const listbox = select.locator('xpath=..').locator('[role="listbox"]');
  await listbox.waitFor({ state: 'visible', timeout: 15000 });
  await listbox
    .locator('[role="option"]:not([disabled])')
    .first()
    .evaluate((element) => element.click());
  const editor = page.getByTestId('writer-studio-editor').first();
  await editor.waitFor({ state: 'visible', timeout: 60000 });
  return editor;
}

const databases = (page) =>
  page.evaluate(async () =>
    (await indexedDB.databases())
      .map((db) => ({ name: db.name, version: db.version }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  );

async function shot(page, name) {
  await page.screenshot({ path: join(outDir, `${phase}-${name}.png`) }).catch(() => {});
}

async function main() {
  const { browser, page } = await connect();
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`.slice(0, 300)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`.slice(0, 300));
  });
  const result = { phase, token, url: page.url(), checks: [] };
  const check = (name, ok, detail = '') => {
    result.checks.push({ name, ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` [${detail}]` : ''}`);
  };
  try {
    await waitForShell(page);
    result.startup = await startupState(page);
    log(`startup state ${result.startup}, url ${page.url()}`);
    if (phase === 'seed') {
      check('fresh profile starts at the welcome portal', result.startup === 'WELCOME_PORTAL');
      await createBlankProject(page);
      const editor = await openWriterEditor(page);
      await editor.fill(`First draft ${token}`);
      await sleep(6000);
      check('editor holds the typed text', (await editor.inputValue()).includes(token));
      await shot(page, 'after-typing');
    } else if (phase === 'verify') {
      check(
        'app restarts into the existing project, not the welcome portal',
        result.startup === 'MAIN_CHROME',
        result.startup,
      );
      const editor = await openWriterEditor(page);
      const value = await editor.inputValue();
      for (const expected of (flag('--expect') ?? token).split(',')) {
        check(`editor text still contains ${expected}`, value.includes(expected));
      }
      const append = flag('--append');
      if (append) {
        await editor.fill(`${value}\nSecond draft ${append}`);
        await sleep(6000);
        check('new version can write more text', (await editor.inputValue()).includes(append));
      }
      await shot(page, 'after-read');
    } else if (phase === 'absent') {
      let present = false;
      if (result.startup === 'MAIN_CHROME') {
        const editor = await openWriterEditor(page).catch(() => null);
        present = editor ? (await editor.inputValue()).includes(token) : false;
      }
      check(
        'negative control: the token is absent after the profile data was removed',
        !present,
        result.startup,
      );
    }
    result.databases = await databases(page);
    log(`indexedDB databases: ${JSON.stringify(result.databases)}`);
    const seedPath = flag('--seed-json');
    if (seedPath) {
      const seeded = JSON.parse(readFileSync(seedPath, 'utf8')).databases ?? [];
      const same = JSON.stringify(seeded) === JSON.stringify(result.databases);
      check(
        'IndexedDB database names and versions equal those written by v1.29.2',
        same,
        same
          ? `${seeded.length} databases`
          : `before ${JSON.stringify(seeded)} after ${JSON.stringify(result.databases)}`,
      );
    }
  } catch (error) {
    check('phase completed without an exception', false, String(error).slice(0, 400));
    await shot(page, 'failure');
  } finally {
    result.consoleErrors = consoleErrors.slice(0, 20);
    writeFileSync(join(outDir, `result-${phase}.json`), `${JSON.stringify(result, null, 2)}\n`);
    await browser.close().catch(() => {});
  }
  process.exitCode = result.checks.every((c) => c.ok) ? 0 : 1;
}

await main();
