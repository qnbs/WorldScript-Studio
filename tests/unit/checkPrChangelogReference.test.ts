// @vitest-environment node
/**
 * Tests for scripts/check-pr-changelog-reference.mjs — the pre-merge admission gate closing the
 * blind spot where scripts/check-doc-metrics.mjs's completeness check only fires AFTER squash-merge
 * (recurred 3x: #678->#679, #684->#685, #699->#700).
 */
import { describe, expect, it } from 'vitest';
import {
  checkPrChangelogReference,
  isReferencedByPrLabel,
} from '../../scripts/check-pr-changelog-reference.mjs';

const UNRELEASED = (body: string) => `## [Unreleased]\n\n### Fixed\n\n${body}\n\n## [1.28.6]\n`;

const GOVERNED_TITLE = 'fix(pwa): gate cache activation on precache success';

interface CheckInput {
  prNumber: number;
  prTitle: string;
  entryBody: string;
}

// QNBS-v3: single fixture builder for every case below — CodeScene flagged the prior per-test literal duplication as unhealthy new code.
function check({ prNumber = 700, prTitle = GOVERNED_TITLE, entryBody }: Partial<CheckInput>) {
  return checkPrChangelogReference({
    prNumber,
    prTitle,
    changelog: UNRELEASED(entryBody ?? '- **PWA precache admission:** hardens activation.'),
  });
}

describe('checkPrChangelogReference', () => {
  it.each([
    [
      '1. "feat:" title',
      'feat(writer): add outline templates',
      700,
      '- Adds starter templates. PR #700.',
    ],
    [
      '2. "fix:" title',
      'fix(pwa): gate cache activation on precache success',
      700,
      '- Hardens activation. PR #700.',
    ],
    [
      '3. "perf:" title',
      'perf(rag): batch embedding lookups',
      700,
      '- Reduces lookup overhead. PR #700.',
    ],
    [
      '4. scoped title',
      'fix(pwa): gate cache-generation activation',
      525,
      '- Described here. PR #525.',
    ],
    [
      '5. breaking-change "!" title',
      'feat(api)!: drop legacy v1 provider adapter',
      812,
      '- Drops v1 adapter. PR #812.',
    ],
    ['13. case/whitespace tolerant "pr#N"', GOVERNED_TITLE, 700, '- Hardens activation. pr#700.'],
  ] as const)(
    'accepts a governed PR whose entry cites its own number (%s)',
    (_label, prTitle, prNumber, entryBody) => {
      expect(check({ prNumber, prTitle, entryBody }).ok).toBe(true);
    },
  );

  it.each([
    ['6. no reference at all', '- Hardens activation.'],
    ['7. a DIFFERENT PR number', '- Unrelated change, see write-up. PR #501.'],
    ['8. bare "#N" lacking the "PR" grammar', '- Hardens activation. #700.'],
    ['9. trailing "(#N)" squash style pre-merge', '- Hardens activation (#700).'],
  ] as const)('rejects a governed PR whose entry has %s', (_label, entryBody) => {
    expect(check({ entryBody })).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('10. skips a non-governed PR title regardless of Unreleased content', () => {
    expect(
      check({ prTitle: 'docs: fix typo in README', entryBody: '- no reference at all' }),
    ).toEqual({
      ok: true,
      reason: 'not-governed',
    });
  });

  it('11. does not let "PR #700" satisfy a check for the shorter number 70 (no partial-left match)', () => {
    expect(check({ prNumber: 70, entryBody: '- Unrelated. PR #700.' })).toEqual({
      ok: false,
      reason: 'missing-reference',
    });
  });

  it('12. does not let "PR #7000" satisfy a check for the shorter number 700 (no partial-right match)', () => {
    expect(check({ entryBody: '- Unrelated. PR #7000.' })).toEqual({
      ok: false,
      reason: 'missing-reference',
    });
  });

  it('isReferencedByPrLabel directly tolerates missing whitespace, e.g. "pr#700"', () => {
    expect(isReferencedByPrLabel(700, 'lowercase and tight: pr#700 done')).toBe(true);
  });

  it('14. rejects a reference that appears only in prose outside any bullet entry', () => {
    const changelog = `## [Unreleased]\n\n### Fixed\n\nNote: tracked under PR #700, changelog entry pending.\n\n- **Something else:** unrelated bullet content.\n\n## [1.28.6]\n`;
    expect(
      checkPrChangelogReference({ prNumber: 700, prTitle: GOVERNED_TITLE, changelog }),
    ).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it("15. accepts a reference on a bullet's own soft-wrapped continuation line", () => {
    const changelog = `## [Unreleased]\n\n### Fixed\n\n- **Hardens activation:** wraps across\n  a continuation line. PR #700.\n\n## [1.28.6]\n`;
    expect(
      checkPrChangelogReference({ prNumber: 700, prTitle: GOVERNED_TITLE, changelog }),
    ).toEqual({ ok: true, reason: 'referenced' });
  });

  it.each([
    ['16. a trailing letter suffix, e.g. "PR #700alpha"', '- Hardens activation. PR #700alpha.'],
    [
      '17. a trailing underscore suffix, e.g. "PR #700_internal"',
      '- Hardens activation. PR #700_internal.',
    ],
  ] as const)('rejects a near-miss reference with %s', (_label, entryBody) => {
    expect(check({ entryBody })).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('18. does not let a heading immediately after a bullet (no blank line) absorb the heading text as a continuation', () => {
    const changelog = `## [Unreleased]\n\n### Fixed\n\n- **Something else:** unrelated bullet content.\n### Notes: tracked under PR #700\n\n## [1.28.6]\n`;
    expect(
      checkPrChangelogReference({ prNumber: 700, prTitle: GOVERNED_TITLE, changelog }),
    ).toEqual({ ok: false, reason: 'missing-reference' });
  });

  describe('historical-incident fixtures (real CHANGELOG text from the three prior recoveries)', () => {
    // QNBS-v3: real bullet text from each incident's own recovery commit, factored so only the trailing reference varies.
    const tauriPluginParityBody =
      "- **Tauri plugin version parity:** bumped npm packages\n  (`@tauri-apps/plugin-http`, `@tauri-apps/plugin-notification`) after #661 bumped only the Rust\n  side, failing every platform's Tauri release build. Bumped the npm packages to match; added\n  `check-tauri-plugin-versions.mjs`, a cheap CI guard catching this class of mismatch before the\n  next release tag instead of at tag-triggered release time.";
    const parityPreflightBody =
      '- **Tauri parity-preflight release gate:** added a `parity-preflight` job (checkout + one\n  dependency-free Node script, no `pnpm install`) that runs `check-tauri-plugin-versions.mjs`\n  before the bundle matrix starts, gated behind `verify-release-tag` so no repository code runs\n  on an unverified release tag. On both `workflow_dispatch` and tag pushes.';
    const precacheAdmissionBody =
      '- **PWA: a failed precache can no longer displace a working service-worker generation (#525):**\n  `install` now rethrows on failure so the whole installation rejects.';

    it('#678->#679: the original merged state (no reference) would have been rejected', () => {
      const result = check({
        prNumber: 678,
        prTitle: 'fix(ci): sync Tauri plugin npm/Rust versions',
        entryBody: tauriPluginParityBody,
      });
      expect(result).toEqual({ ok: false, reason: 'missing-reference' });
    });

    it.each([
      ['#678->#679', 678, 'fix(ci): sync Tauri plugin npm/Rust versions', tauriPluginParityBody],
      ['#684->#685', 684, 'fix(ci): add Tauri release parity-preflight gate', parityPreflightBody],
      [
        '#699->#700',
        699,
        'fix(pwa): gate service-worker cache-generation activation on precache success',
        precacheAdmissionBody,
      ],
    ] as const)(
      '%s: the real recovery entry text satisfies the gate',
      (_label, prNumber, prTitle, body) => {
        const result = check({ prNumber, prTitle, entryBody: `${body} PR #${prNumber}.` });
        expect(result).toEqual({ ok: true, reason: 'referenced' });
      },
    );
  });
});
