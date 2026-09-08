import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkAttributionText,
  FORBIDDEN_ATTRIBUTION_PATTERNS,
} from '../../../scripts/check-commit-attribution.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/check-commit-attribution.mjs');

function runCli(args: string[]) {
  return spawnSync('node', ['scripts/check-commit-attribution.mjs', ...args], {
    encoding: 'utf8',
  });
}

function runCliIn(dir: string, args: string[]) {
  return spawnSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
}

function makeTagFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'worldscript-tag-test-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
  return { dir, env };
}

describe('checkAttributionText', () => {
  it('passes a clean conventional commit', () => {
    const result = checkAttributionText(
      'fix(agent): close final blocking guidance gaps\n\nRoute encryption-recovery UI to the storage boundary rule.\n',
    );
    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it('rejects a Claude co-author trailer', () => {
    const result = checkAttributionText(
      'fix: bump dep\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('co-authored-by-claude');
  });

  it('rejects a lowercase trailer variant', () => {
    const result = checkAttributionText(
      'fix: bump dep\n\nCo-authored-by: Claude Sonnet 5 <noreply@anthropic.com>\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('co-authored-by-claude');
  });

  it('rejects an Anthropic co-author trailer (not just Claude)', () => {
    const result = checkAttributionText('fix: bump dep\n\nCo-Authored-By: Anthropic\n');
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('co-authored-by-claude');
  });

  it('rejects a generated-by-Anthropic footer (not just Claude)', () => {
    const result = checkAttributionText('fix: bump dep\n\nGenerated with Anthropic\n');
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('generated-by-claude-footer');
  });

  it('rejects a direct claude.com session URL with no intermediate path segment', () => {
    const result = checkAttributionText('fix: bump dep\n\nhttps://claude.com/session_abc123\n');
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('claude-com-session-url');
  });

  it('rejects a Claude-Session trailer', () => {
    const result = checkAttributionText(
      'fix: bump dep\n\nClaude-Session: https://claude.ai/code/session_abc123\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matches).toEqual(
      expect.arrayContaining(['claude-session-trailer', 'claude-session-url']),
    );
  });

  it('rejects a generated-by footer', () => {
    const result = checkAttributionText('fix: bump dep\n\n🤖 Generated with Claude Code\n');
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('generated-by-claude-footer');
  });

  it('rejects a generated-by footer with no emoji prefix', () => {
    const result = checkAttributionText('fix: bump dep\n\nGenerated with Claude Code\n');
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('generated-by-claude-footer');
  });

  it('rejects the GitHub-Copilot-with-Claude co-author form', () => {
    const result = checkAttributionText(
      'fix: bump dep\n\nCo-Authored-By: GitHub Copilot (Claude Sonnet 5)\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('copilot-claude-co-author');
  });

  it('rejects a co-author trailer with a custom name via the anthropic email, still trailer-anchored', () => {
    const result = checkAttributionText(
      'fix: bump dep\n\nCo-Authored-By: AI Assistant <noreply@anthropic.com>\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('anthropic-noreply-email');
  });

  it('passes prose that merely discusses the anthropic noreply address, not in a trailer', () => {
    const result = checkAttributionText(
      'docs: document that this guard rejects noreply@anthropic.com in commit trailers\n',
    );
    expect(result.ok).toBe(true);
  });

  it('passes legitimate prose about the Claude provider', () => {
    const result = checkAttributionText(
      'feat(ai): improve Claude provider retry handling\n\nAligns backoff with the OpenAI provider.\n',
    );
    expect(result.ok).toBe(true);
  });

  it('passes legitimate Anthropic documentation prose', () => {
    const result = checkAttributionText('docs: document the Anthropic API key rotation flow\n');
    expect(result.ok).toBe(true);
  });

  it('exposes one pattern per forbidden category', () => {
    expect(FORBIDDEN_ATTRIBUTION_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });
});

describe('check-commit-attribution CLI', () => {
  it('rejects --message with no following value as a usage error, not a silent pass', () => {
    const result = runCli(['--message']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--message requires a text argument/);
  });

  it('rejects --file with no following value as a usage error, not a silent pass', () => {
    const result = runCli(['--file']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--file requires a path argument/);
  });

  it('fails closed with a clear message on a missing --file path', () => {
    const result = runCli(['--file', '/nonexistent/path/does-not-exist.txt']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/cannot read/);
  });

  it('exits 0 for a clean --message', () => {
    const result = runCli(['--message', 'chore: bump dependency']);
    expect(result.status).toBe(0);
  });
});

describe('check-commit-attribution --tag mode', () => {
  it('accepts a clean tag pointing at a clean commit', () => {
    const { dir, env } = makeTagFixture();
    try {
      execFileSync(
        'git',
        ['-C', dir, 'commit', '--quiet', '--allow-empty', '-m', 'chore: initial'],
        {
          env,
        },
      );
      execFileSync('git', ['-C', dir, 'tag', '-a', 'v1.0.0', '-m', 'clean release notes'], { env });
      const tagSha = execFileSync('git', ['-C', dir, 'rev-parse', 'v1.0.0'], {
        encoding: 'utf8',
      }).trim();
      const result = runCliIn(dir, ['--tag', tagSha]);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a clean tag annotation that targets an attributed commit', () => {
    const { dir, env } = makeTagFixture();
    try {
      execFileSync(
        'git',
        [
          '-C',
          dir,
          'commit',
          '--quiet',
          '--allow-empty',
          '-m',
          'fix: bump dep\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>',
        ],
        { env },
      );
      execFileSync('git', ['-C', dir, 'tag', '-a', 'v1.0.0', '-m', 'clean release notes'], { env });
      const tagSha = execFileSync('git', ['-C', dir, 'rev-parse', 'v1.0.0'], {
        encoding: 'utf8',
      }).trim();
      const result = runCliIn(dir, ['--tag', tagSha]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/co-authored-by-claude/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an attributed tag annotation even when the target commit is clean', () => {
    const { dir, env } = makeTagFixture();
    try {
      execFileSync(
        'git',
        ['-C', dir, 'commit', '--quiet', '--allow-empty', '-m', 'chore: initial'],
        {
          env,
        },
      );
      execFileSync(
        'git',
        [
          '-C',
          dir,
          'tag',
          '-a',
          'v1.0.0',
          '-m',
          'Claude-Session: https://claude.ai/code/session_x',
        ],
        { env },
      );
      const tagSha = execFileSync('git', ['-C', dir, 'rev-parse', 'v1.0.0'], {
        encoding: 'utf8',
      }).trim();
      const result = runCliIn(dir, ['--tag', tagSha]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/claude-session/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --tag with no following value as a usage error', () => {
    const result = runCli(['--tag']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--tag requires a SHA argument/);
  });
});
