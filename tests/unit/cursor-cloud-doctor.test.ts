import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cursor-cloud-doctor.mjs', () => {
  const script = resolve(process.cwd(), 'scripts/cursor-cloud-doctor.mjs');

  it('emits JSON with expected diagnostic keys and no secret-shaped fields', () => {
    const raw = execFileSync(process.execPath, [script, '--json'], {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, CURSOR_CLOUD_DOCTOR_OFFLINE: '1', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const summary = JSON.parse(raw) as Record<string, unknown>;
    expect(summary['head']).toEqual(expect.any(String));
    expect(summary['worktreeClean']).toEqual(expect.any(Boolean));
    expect(summary['gitTransport']).toEqual(expect.any(String));
    expect(summary['ghApi']).toEqual('offline-skipped');
    expect(JSON.stringify(summary)).not.toMatch(/Bearer |ghp_|gho_/i);
  });
});
