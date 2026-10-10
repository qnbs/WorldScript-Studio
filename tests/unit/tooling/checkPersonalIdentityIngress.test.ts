import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyEmail,
  validatePolicy,
} from '../../../scripts/check-personal-identity-ingress.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/check-personal-identity-ingress.mjs');
const ATTRIBUTION = resolve(process.cwd(), 'scripts/check-commit-attribution.mjs');
const POLICY = resolve(process.cwd(), 'config/personal-identity-ingress-policy.json');
const SAFE_NAME = 'Example Maintainer';
const SAFE_EMAIL = '12345678+example-maintainer@users.noreply.github.com';
const OTHER_EMAIL = 'synthetic.person@example.invalid';
const OTHER_NAME = 'Synthetic Person';

function identityEnv(name: string, email: string) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

function git(dir: string, args: string[], env = identityEnv(SAFE_NAME, SAFE_EMAIL)) {
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
}

// QNBS-v3: fixture commits disable signing because the temp repo has no key; the guard reads identity fields, not signatures.
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'worldscript-identity-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'personal-identity-ingress-policy.json'), readFileSync(POLICY));
  return dir;
}

function commit(
  dir: string,
  message: string,
  name = SAFE_NAME,
  email = SAFE_EMAIL,
  file = 'note.txt',
) {
  writeFileSync(join(dir, file), `${message}\n`);
  git(dir, ['add', file], identityEnv(name, email));
  git(dir, ['commit', '--quiet', '-m', message], identityEnv(name, email));
  return git(dir, ['rev-parse', 'HEAD'], identityEnv(name, email)).trim();
}

function runGuard(dir: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
}

describe('personal identity policy', () => {
  it('accepts only the GitHub noreply class', () => {
    expect(classifyEmail(SAFE_EMAIL)).toBe('github-noreply');
    expect(classifyEmail(OTHER_EMAIL)).toBe('unapproved');
    expect(classifyEmail('')).toBe('missing');
    const policy = JSON.parse(readFileSync(POLICY, 'utf8')) as unknown;
    expect(validatePolicy(policy).ok).toBe(true);
    expect(validatePolicy({ ...(policy as object), allowAll: true }).ok).toBe(false);
    expect(
      validatePolicy({
        ...(policy as object),
        allowedEmailClasses: ['github-noreply', 'any'],
      }).ok,
    ).toBe(false);
  });
});

describe('personal identity ingress guard', () => {
  it('fails closed without a resolved range', () => {
    const dir = initRepo();
    try {
      const result = runGuard(dir, []);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('RANGE_REQUIRED');
      expect(`${result.stdout}${result.stderr}`).not.toContain('OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when the policy file is missing or weakened', () => {
    const dir = initRepo();
    try {
      rmSync(join(dir, 'config', 'personal-identity-ingress-policy.json'));
      const missing = runGuard(dir, ['HEAD', 'HEAD']);
      expect(missing.status).toBe(2);
      expect(missing.stderr).toContain('POLICY_UNAVAILABLE');
      const weakened = join(dir, 'weak.json');
      writeFileSync(
        weakened,
        JSON.stringify({
          schemaVersion: 1,
          mode: 'fail-open',
          newWritesOnly: true,
          allowedEmailClasses: ['github-noreply'],
          identityTrailers: ['co-authored-by', 'signed-off-by'],
          providerManagedRefs: 'UNRESOLVED_PROVIDER_PURGE',
        }),
      );
      const rejected = runGuard(dir, ['--policy', weakened, 'HEAD', 'HEAD']);
      expect(rejected.status).toBe(2);
      expect(rejected.stderr).toContain('POLICY_UNAVAILABLE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets the message-only attribution checker pass while this guard is red', () => {
    const dir = initRepo();
    try {
      const base = commit(dir, 'baseline');
      commit(dir, 'feat: synthetic leak', OTHER_NAME, OTHER_EMAIL);
      const attribution = spawnSync(process.execPath, [ATTRIBUTION, base, 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      });
      const guard = runGuard(dir, [base, 'HEAD']);
      expect(attribution.status).toBe(0);
      expect(guard.status).toBe(1);
      expect(guard.stderr).toContain('unapproved-email:author');
      expect(guard.stderr).toContain('unapproved-email:committer');
      expect(guard.stderr).not.toContain(OTHER_EMAIL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a noreply identity with an arbitrary display name and ignores older parents', () => {
    const dir = initRepo();
    try {
      const parent = commit(dir, 'historical synthetic', OTHER_NAME, OTHER_EMAIL);
      commit(dir, 'feat: allowed new write', 'Any Display Name', SAFE_EMAIL);
      const guard = runGuard(dir, [parent, 'HEAD']);
      expect(guard.status).toBe(0);
      expect(guard.stdout).toContain('audited 1 introduced commit(s)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects multiline co-authored-by and signed-off-by trailers regardless of case', () => {
    const dir = initRepo();
    try {
      const base = commit(dir, 'baseline');
      commit(
        dir,
        'feat: trailers\n\nCo-authored-by: Synthetic Person <synthetic.person@example.invalid>\nSIGNED-OFF-BY: Synthetic Person <synthetic.person@example.invalid>\n',
      );
      const guard = runGuard(dir, [base, 'HEAD']);
      expect(guard.status).toBe(1);
      expect(guard.stderr).toContain('unapproved-email:co-authored-by');
      expect(guard.stderr).toContain('unapproved-email:signed-off-by');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts noreply trailers and rejects a malformed trailer', () => {
    const dir = initRepo();
    try {
      const base = commit(dir, 'baseline');
      commit(
        dir,
        'feat: safe trailer\n\nCo-Authored-By: Example Maintainer <12345678+example-maintainer@users.noreply.github.com>\n',
      );
      expect(runGuard(dir, [base, 'HEAD']).status).toBe(0);
      commit(dir, 'feat: broken trailer\n\nSigned-off-by: nobody\n');
      const malformed = runGuard(dir, [base, 'HEAD']);
      expect(malformed.status).toBe(1);
      expect(malformed.stderr).toContain('malformed-trailer:signed-off-by');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an amended committer email and a merge committer email', () => {
    const dir = initRepo();
    try {
      const base = commit(dir, 'baseline');
      commit(dir, 'feat: amend me');
      git(
        dir,
        [
          'commit',
          '--quiet',
          '--amend',
          '--allow-empty',
          `--author=${SAFE_NAME} <${SAFE_EMAIL}>`,
          '-m',
          'feat: amended',
        ],
        identityEnv(OTHER_NAME, OTHER_EMAIL),
      );
      const amended = runGuard(dir, [base, 'HEAD']);
      expect(amended.status).toBe(1);
      expect(amended.stderr).toContain('unapproved-email:committer');
      expect(amended.stderr).not.toContain('unapproved-email:author');

      git(dir, ['checkout', '--quiet', '-b', 'topic', base]);
      commit(dir, 'feat: side', SAFE_NAME, SAFE_EMAIL, 'side.txt');
      git(dir, ['checkout', '--quiet', 'main']);
      git(
        dir,
        ['merge', '--no-ff', '--quiet', '-m', 'Merge topic', 'topic'],
        identityEnv(OTHER_NAME, OTHER_EMAIL),
      );
      const merged = runGuard(dir, [base, 'HEAD']);
      expect(merged.status).toBe(1);
      expect(merged.stderr).toContain('unapproved-email:committer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('classifies an annotated tagger and does not walk a disjoint target as a new write', () => {
    const dir = initRepo();
    try {
      commit(dir, 'historical synthetic', OTHER_NAME, OTHER_EMAIL);
      const target = git(dir, ['rev-parse', 'HEAD']).trim();
      git(
        dir,
        ['tag', '-a', 'demo-safe', '-m', 'synthetic tag', target],
        identityEnv(SAFE_NAME, SAFE_EMAIL),
      );
      const safeTag = git(dir, ['rev-parse', 'demo-safe']).trim();
      const safe = runGuard(dir, ['--tag', safeTag]);
      expect(safe.status).toBe(0);
      expect(safe.stdout).toContain('audited annotated tagger');
      git(
        dir,
        ['tag', '-a', 'demo-open', '-m', 'synthetic tag', target],
        identityEnv(OTHER_NAME, OTHER_EMAIL),
      );
      const openTag = git(dir, ['rev-parse', 'demo-open']).trim();
      const open = runGuard(dir, ['--tag', openTag]);
      expect(open.status).toBe(1);
      expect(open.stderr).toContain('unapproved-email:tagger');
      git(dir, ['tag', 'demo-light', target], identityEnv(SAFE_NAME, SAFE_EMAIL));
      const light = git(dir, ['rev-parse', 'demo-light']).trim();
      const lightweight = runGuard(dir, ['--tag', light]);
      expect(lightweight.status).toBe(1);
      expect(lightweight.stderr).toContain('TAG_IDENTITY_UNAVAILABLE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports provider-managed pull refs as unresolved and missing history as unavailable', () => {
    const dir = initRepo();
    try {
      const head = commit(dir, 'baseline');
      git(dir, ['update-ref', 'refs/pull/9/head', head]);
      const provider = runGuard(dir, ['--provider-ref', 'refs/pull/9/head']);
      expect(provider.status).toBe(3);
      expect(provider.stderr).toContain('UNRESOLVED_PROVIDER_PURGE');
      expect(provider.stdout).not.toContain('OK');
      const missing = runGuard(dir, ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'HEAD']);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('HISTORY_UNAVAILABLE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
