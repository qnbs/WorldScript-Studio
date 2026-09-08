import { describe, expect, it } from 'vitest';
import {
  checkAttributionText,
  FORBIDDEN_ATTRIBUTION_PATTERNS,
} from '../../../scripts/check-commit-attribution.mjs';

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
