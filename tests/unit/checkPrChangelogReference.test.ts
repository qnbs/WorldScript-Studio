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

describe('checkPrChangelogReference', () => {
  it('1. accepts a governed "feat:" PR whose Unreleased entry cites "PR #<N>"', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'feat(writer): add outline templates',
      changelog: UNRELEASED('- **Outline templates:** adds starter templates. PR #700.'),
    });
    expect(result).toEqual({ ok: true, reason: 'referenced' });
  });

  it('2. accepts a governed "fix:" PR whose Unreleased entry cites "PR #<N>"', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(pwa): gate cache activation on precache success',
      changelog: UNRELEASED('- **PWA precache admission:** hardens activation. PR #700.'),
    });
    expect(result.ok).toBe(true);
  });

  it('3. accepts a governed "perf:" PR whose Unreleased entry cites "PR #<N>"', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'perf(rag): batch embedding lookups',
      changelog: UNRELEASED('- **RAG batching:** reduces lookup overhead. PR #700.'),
    });
    expect(result.ok).toBe(true);
  });

  it('4. accepts a scoped governed title, e.g. "fix(pwa): ..."', () => {
    const result = checkPrChangelogReference({
      prNumber: 525,
      prTitle: 'fix(pwa): gate cache-generation activation on precache success',
      changelog: UNRELEASED('- **SW admission gate:** described here. PR #525.'),
    });
    expect(result.ok).toBe(true);
  });

  it('5. accepts a breaking-change "!" governed title, e.g. "feat(api)!: ..."', () => {
    const result = checkPrChangelogReference({
      prNumber: 812,
      prTitle: 'feat(api)!: drop legacy v1 provider adapter',
      changelog: UNRELEASED('- **Legacy provider removal:** drops v1 adapter. PR #812.'),
    });
    expect(result.ok).toBe(true);
  });

  it('6. rejects a governed PR whose Unreleased section has no reference at all', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(pwa): gate cache activation on precache success',
      changelog: UNRELEASED('- **PWA precache admission:** hardens activation.'),
    });
    expect(result).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('7. rejects a governed PR whose Unreleased entry cites a DIFFERENT PR number', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(pwa): gate cache activation on precache success',
      changelog: UNRELEASED('- **Unrelated change:** see write-up. PR #501.'),
    });
    expect(result).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('8. rejects a bare "#<N>" reference lacking the "PR" grammar', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(pwa): gate cache activation on precache success',
      changelog: UNRELEASED('- **PWA precache admission:** hardens activation. #700.'),
    });
    expect(result).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('9. rejects a trailing "(#<N>)" squash-style reference pre-merge (no "PR" word)', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(pwa): gate cache activation on precache success',
      changelog: UNRELEASED('- **PWA precache admission:** hardens activation (#700).'),
    });
    expect(result).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('10. skips a non-governed PR title (e.g. "docs:") regardless of Unreleased content', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'docs: fix typo in README',
      changelog: UNRELEASED('- unrelated content with no reference at all'),
    });
    expect(result).toEqual({ ok: true, reason: 'not-governed' });
  });

  it('11. does not let "PR #700" satisfy a check for the shorter number 70 (no partial-left match)', () => {
    const result = checkPrChangelogReference({
      prNumber: 70,
      prTitle: 'fix(core): narrow number-boundary regression',
      changelog: UNRELEASED('- **Unrelated:** references a different change. PR #700.'),
    });
    expect(result).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('12. does not let "PR #7000" satisfy a check for the shorter number 700 (no partial-right match)', () => {
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(core): narrow number-boundary regression',
      changelog: UNRELEASED('- **Unrelated:** references a different change. PR #7000.'),
    });
    expect(result).toEqual({ ok: false, reason: 'missing-reference' });
  });

  it('13. tolerates case and missing whitespace, e.g. "pr#700"', () => {
    expect(isReferencedByPrLabel(700, 'lowercase and tight: pr#700 done')).toBe(true);
    const result = checkPrChangelogReference({
      prNumber: 700,
      prTitle: 'fix(pwa): gate cache activation on precache success',
      changelog: UNRELEASED('- **PWA precache admission:** hardens activation. pr#700.'),
    });
    expect(result.ok).toBe(true);
  });

  describe('historical-incident fixtures (real CHANGELOG text from the three prior recoveries)', () => {
    it('#678->#679: the original merged state (no reference) would have been rejected', () => {
      const originalUnreleased = UNRELEASED(
        "- **Tauri plugin version parity:** bumped npm packages\n  (`@tauri-apps/plugin-http`, `@tauri-apps/plugin-notification`) after #661 bumped only the Rust\n  side, failing every platform's Tauri release build. Bumped the npm packages to match; added\n  `check-tauri-plugin-versions.mjs`, a cheap CI guard catching this class of mismatch before the\n  next release tag instead of at tag-triggered release time.",
      );
      const result = checkPrChangelogReference({
        prNumber: 678,
        prTitle: 'fix(ci): sync Tauri plugin npm/Rust versions',
        changelog: originalUnreleased,
      });
      expect(result).toEqual({ ok: false, reason: 'missing-reference' });
    });

    it('#678->#679: the real recovery entry text ("...PR #678.") satisfies the gate', () => {
      const recoveredUnreleased = UNRELEASED(
        "- **Tauri plugin version parity:** bumped npm packages\n  (`@tauri-apps/plugin-http`, `@tauri-apps/plugin-notification`) after #661 bumped only the Rust\n  side, failing every platform's Tauri release build. Bumped the npm packages to match; added\n  `check-tauri-plugin-versions.mjs`, a cheap CI guard catching this class of mismatch before the\n  next release tag instead of at tag-triggered release time. PR #678.",
      );
      const result = checkPrChangelogReference({
        prNumber: 678,
        prTitle: 'fix(ci): sync Tauri plugin npm/Rust versions',
        changelog: recoveredUnreleased,
      });
      expect(result).toEqual({ ok: true, reason: 'referenced' });
    });

    it('#684->#685: the real recovery entry text ("...PR #684.") satisfies the gate', () => {
      const recoveredUnreleased = UNRELEASED(
        '- **Tauri parity-preflight release gate:** added a `parity-preflight` job (checkout + one\n  dependency-free Node script, no `pnpm install`) that runs `check-tauri-plugin-versions.mjs`\n  before the bundle matrix starts, gated behind `verify-release-tag` so no repository code runs\n  on an unverified release tag. On both `workflow_dispatch` and tag pushes. PR #684.',
      );
      const result = checkPrChangelogReference({
        prNumber: 684,
        prTitle: 'fix(ci): add Tauri release parity-preflight gate',
        changelog: recoveredUnreleased,
      });
      expect(result).toEqual({ ok: true, reason: 'referenced' });
    });

    it('#699->#700: the real recovery entry text ("...PR #699.") satisfies the gate', () => {
      const recoveredUnreleased = UNRELEASED(
        '- **PWA: a failed precache can no longer displace a working service-worker generation (#525):**\n  `install` now rethrows on failure so the whole installation rejects. PR #699.',
      );
      const result = checkPrChangelogReference({
        prNumber: 699,
        prTitle: 'fix(pwa): gate service-worker cache-generation activation on precache success',
        changelog: recoveredUnreleased,
      });
      expect(result).toEqual({ ok: true, reason: 'referenced' });
    });
  });
});
