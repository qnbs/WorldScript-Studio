// Phase 0 of #1217 (evidence branch only, never merged): attach tauri-driver to the installed app and prove that a
// session can read the DOM and IndexedDB. Plain WebDriver HTTP, no client library.
import { writeFileSync } from 'node:fs';

const [application, outDir = '.', port = '4444', mode = 'tauri'] = process.argv.slice(2);
// The optional port and mode let the Windows diagnosis talk to msedgedriver directly, as tauri-driver does internally.
const base = `http://127.0.0.1:${port}`;
const capabilities =
  mode === 'edge'
    ? { browserName: 'webview2', 'ms:edgeOptions': { binary: application, webviewOptions: {} } }
    : { 'tauri:options': { application } };

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json.value;
}

const report = { application, mode, steps: [] };
const step = (name, value) => {
  report.steps.push({ name, value });
  console.log(`${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
};

const session = await call('POST', '/session', {
  capabilities: { alwaysMatch: capabilities },
});
const id = session.sessionId;
step('session', { id, browserName: session.capabilities?.browserName ?? null });
try {
  await new Promise((resolve) => setTimeout(resolve, 8000));
  step('title', await call('GET', `/session/${id}/title`));
  step('url', await call('GET', `/session/${id}/url`));
  const body = await call('POST', `/session/${id}/element`, {
    using: 'css selector',
    value: 'body',
  });
  const text = await call('GET', `/session/${id}/element/${Object.values(body)[0]}/text`);
  step('bodyTextLength', text.length);
  step(
    'indexedDB.databases',
    await call('POST', `/session/${id}/execute/async`, {
      script:
        "const done = arguments[arguments.length - 1]; indexedDB.databases().then((dbs) => done(dbs.map((d) => d.name + '@' + d.version))).catch((e) => done('error: ' + e));",
      args: [],
    }),
  );
  step(
    'userAgent',
    await call('POST', `/session/${id}/execute/sync`, {
      script: 'return navigator.userAgent;',
      args: [],
    }),
  );
  const png = await call('GET', `/session/${id}/screenshot`);
  writeFileSync(`${outDir}/phase0-screenshot.png`, Buffer.from(png, 'base64'));
  step('screenshot', 'phase0-screenshot.png');
} finally {
  await call('DELETE', `/session/${id}`).catch((e) => step('deleteSession', String(e)));
  writeFileSync(`${outDir}/phase0-report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
