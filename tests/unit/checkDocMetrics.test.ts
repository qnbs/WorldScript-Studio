// @vitest-environment node
/**
 * Tests for scripts/check-doc-metrics.mjs
 * QNBS-v3: the historical-section exclusion heuristic is the part most likely to silently break
 * (an untested exclusion rule turns the drift gate into noise) — this file's primary job is
 * proving it actually excludes a dated snapshot and does NOT excuse a present-tense claim.
 */
import { describe, expect, it } from 'vitest';
import { scanForDrift, stripHistoricalSections } from '../../scripts/check-doc-metrics.mjs';

describe('stripHistoricalSections', () => {
  it('blanks a Keep-a-Changelog-style `## [x.y.z]` section', () => {
    const md = [
      '## [1.24.0] — 2026-06-21',
      '',
      'Shipped with 17 locales.',
      '',
      '## Current state',
      '',
      'Ships 19 locales.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toContain('17 locales');
    expect(stripped).toContain('19 locales');
  });

  it('blanks a `## vX.Y.Z … RELEASED …` section', () => {
    const md = [
      '## v1.23.0 — Rebrand (RELEASED 2026-06-16)',
      '',
      'Shipped with 11 locales.',
      '',
      '## Upcoming',
      '',
      'Targeting 19 locales.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toContain('11 locales');
    expect(stripped).toContain('19 locales');
  });

  it('does NOT exclude a present-tense heading that merely mentions a version in prose', () => {
    const md = ['## Current status', '', 'As of v1.24.1, the app ships 17 locales.'].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).toContain('17 locales');
  });

  it('re-enables scanning once a non-historical heading follows a historical one', () => {
    const md = [
      '## [1.23.0]',
      'Historical: 11 locales.',
      '## Roadmap',
      'Present: 17 locales.',
      '## [1.24.0]',
      'Historical again: 11 locales.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toMatch(/Historical/);
    expect(stripped).toContain('Present: 17 locales.');
  });
});

describe('scanForDrift', () => {
  const actual = { localeCount: 19, keyCount: 2849, latestVersion: '1.24.1' };

  it('flags a present-tense locale-count mismatch', () => {
    const content = 'WorldScript Studio ships **17 locales**.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('17 locale'))).toBe(true);
  });

  it('does not flag a matching locale count', () => {
    const content = 'WorldScript Studio ships **19 locales**.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });

  it('does not flag a locale-count mismatch inside a historical section', () => {
    const content = ['## [1.23.0]', '', 'Shipped 11 locales.'].join('\n');
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });

  it('flags a key-count mismatch', () => {
    const content = 'Shipped UI locales with **2844 i18n keys**.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('2844'))).toBe(true);
  });

  it('flags a stale PLANNED marker for an already-released version', () => {
    const content = '## Upcoming — v1.24 (PLANNED)';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('PLANNED'))).toBe(true);
  });

  it('does not flag a PLANNED marker for a version newer than the latest release', () => {
    const content = '## Upcoming — v2.0 (PLANNED)';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });
});
