import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cursor-cloud-doctor.mjs', () => {
  const script = resolve(process.cwd(), 'scripts/cursor-cloud-doctor.mjs');

  it('emits JSON with expected diagnostic keys and no secret-shaped fields', () => {
    const raw = execFileSync(process.execPath, [script, '--json'], {
      encoding: 'utf8',
    });
    const summary = JSON.parse(raw) as Record<string, unknown>;
    expect(summary['head']).toEqual(expect.any(String));
    expect(summary['worktreeClean']).toEqual(expect.any(Boolean));
    expect(summary['gitTransport']).toEqual(expect.any(String));
    expect(summary['ghApi']).toEqual(expect.any(String));
    expect(JSON.stringify(summary)).not.toMatch(/Bearer |ghp_|gho_/i);
  });
});
