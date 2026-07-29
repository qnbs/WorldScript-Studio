// @vitest-environment node
/**
 * Tests for scripts/check-doc-metrics.mjs
 * QNBS-v3: protects the drift gate from historical-section regressions — an untested exclusion heuristic would turn it into noise.
 */
import { describe, expect, it } from 'vitest';
import {
  getCanonicalProductionUrl,
  scanForDrift,
  scanForUrlDrift,
  stripHistoricalSections,
} from '../../scripts/check-doc-metrics.mjs';

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

// QNBS-v3 (F-10): regression guard for the dead worldscript-studio-indol.vercel.app URL that had
// leaked into the in-app link and the Italian locale — this is the check that would have caught it.
describe('getCanonicalProductionUrl', () => {
  it('reads a real https://….vercel.app/ URL from constants/brand.ts', () => {
    const url = getCanonicalProductionUrl();
    expect(url).toMatch(/^https:\/\/worldscript-studio[a-z0-9-]*\.vercel\.app\/$/);
  });
});

describe('scanForUrlDrift', () => {
  const canonical = 'https://worldscript-studio.vercel.app/';

  it('flags a Vercel URL that does not match the canonical one', () => {
    const content = 'Production: https://worldscript-studio-indol.vercel.app/';
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('worldscript-studio-indol.vercel.app');
  });

  it('does not flag the canonical URL', () => {
    const content = `Production: ${canonical}`;
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(0);
  });

  it('does not flag the canonical URL without a trailing slash', () => {
    const content = 'Production: https://worldscript-studio.vercel.app';
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(0);
  });

  it('ignores a mismatched URL inside a historical section', () => {
    const content = [
      '## [1.20.0]',
      '',
      'Was at https://worldscript-studio-old-preview.vercel.app/',
    ].join('\n');
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (CodeRabbit): locales/it/help.json references the host with no `https://` prefix
  // (inside a <code> tag) — the scheme must be optional or this exact drift shape goes undetected.
  it('flags a scheme-less stale Vercel hostname', () => {
    const content = 'URL di produzione: <code>worldscript-studio-indol.vercel.app</code>';
    const findings = scanForUrlDrift(content, 'FAKE.json', canonical);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('worldscript-studio-indol.vercel.app');
  });

  it('does not flag the canonical hostname without a scheme', () => {
    const content = 'URL di produzione: <code>worldscript-studio.vercel.app</code>';
    const findings = scanForUrlDrift(content, 'FAKE.json', canonical);
    expect(findings).toHaveLength(0);
  });
});
