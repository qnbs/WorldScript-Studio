// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const RELEASE_MANIFEST =
  'https://github.com/qnbs/WorldScript-Studio/releases/latest/download/latest.json';
const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
  plugins: { updater: { endpoints: string[] } };
};
const release = (
  parse(readFileSync('.github/workflows/tauri-build.yml', 'utf8')) as {
    jobs: Record<string, { steps?: Step[] }>;
  }
).jobs['release'];

// #1214: every configured endpoint must be something the release workflow actually publishes.
describe('updater endpoints match what the release publishes', () => {
  it('lists only the GitHub Release latest.json the release job generates and uploads', () => {
    expect(tauriConf.plugins.updater.endpoints).toEqual([RELEASE_MANIFEST]);
    const steps = release?.steps ?? [];
    const generate = steps.findIndex((step) =>
      /release-assets-guard\.mjs generate "\$VERSION" release-assets /.test(String(step.run ?? '')),
    );
    const upload = steps.findIndex(
      (step) =>
        String(step.uses ?? '').startsWith('softprops/action-gh-release@') &&
        step.with?.['files'] === 'release-assets/*',
    );
    expect(generate, 'latest.json generation step').toBeGreaterThanOrEqual(0);
    expect(upload, 'release asset upload step').toBeGreaterThan(generate);
  });
});
