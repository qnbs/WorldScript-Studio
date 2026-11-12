// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  run?: string;
}

const STEP = 'Extract deterministic release notes';
const workflow = parse(readFileSync('.github/workflows/tauri-build.yml', 'utf8')) as {
  jobs: Record<string, { steps?: Step[] }>;
};
const run = String(workflow.jobs['release']?.steps?.find((step) => step.name === STEP)?.run);

// The [Unreleased] body and the newest version section: what the next tag publishes.
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const sections = changelog.split(/^## \[/m).slice(1);
const sectionBody = (section: string | undefined) =>
  (section ?? '').slice((section ?? '').indexOf('\n'));
const pendingNotes = [sectionBody(sections[0]), sectionBody(sections[1])];
const INTEL_ENTRY =
  "\n- **macOS Intel:** Releases build a native Intel (x86_64) Mac app again, on GitHub's `macos-26-intel` runner. A non-publishing test dispatch there built a native x86_64 bundle. Intel Macs are supported again. The installers are still neither notarized nor Developer-ID-signed (#574).\n";

// Runs the shipped step for tag v9.9.9 against a CHANGELOG whose 9.9.9 section is `body`.
function extractNotes(body: string) {
  const root = mkdtempSync(join(tmpdir(), 'release-notes-'));
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [9.9.9] — 2026-01-01\n${body}\n## [9.9.8] — 2025-12-31\n\n- older\n`,
  );
  try {
    const result = spawnSync('bash', ['-c', run], {
      cwd: root,
      env: { PATH: process.env['PATH'] ?? '', GITHUB_REF_NAME: 'v9.9.9' },
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// #507 ships Intel macOS; #574 defers OS code signing. The release job must accept the first and refuse uncited signing claims.
describe('release-notes claim checks', () => {
  it('accept the macOS Intel entries that #507 ships', () => {
    expect(extractNotes(INTEL_ENTRY).status).toBe(0);
  });

  it('accept the [Unreleased] body and the newest version section as they stand', () => {
    expect(sections[0]).toMatch(/^Unreleased\]/);
    for (const notes of pendingNotes) expect(extractNotes(notes).status).toBe(0);
  });

  it('refuse a notarization or Developer ID line that does not cite #574', () => {
    const notes = '\n- **macOS:** The app is now notarized and Developer ID signed.\n';
    const result = extractNotes(notes);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('without citing the deferral #574');
  });

  it('accept a signing line that cites the deferral #574', () => {
    expect(
      extractNotes('\n- Installers are not notarized or Authenticode-signed (#574).\n').status,
    ).toBe(0);
  });

  it('still refuse a #332 closure claim', () => {
    expect(extractNotes('\n- #332 is now closed.\n').status).toBe(1);
  });
});
