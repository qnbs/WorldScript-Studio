import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  checkAttributionText,
  FORBIDDEN_ATTRIBUTION_PATTERNS,
} from '../../../scripts/check-commit-attribution.mjs';

function runCli(args: string[]) {
  return spawnSync('node', ['scripts/check-commit-attribution.mjs', ...args], {
    encoding: 'utf8',
  });
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

  it('rejects the GitHub-Copilot-with-Claude co-author form', () => {
    const result = checkAttributionText(
      'fix: bump dep\n\nCo-Authored-By: GitHub Copilot (Claude Sonnet 5)\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matches).toContain('copilot-claude-co-author');
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
