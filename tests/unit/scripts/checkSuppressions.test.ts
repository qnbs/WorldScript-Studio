// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decideGateAction,
  decideUpdateAction,
  root,
} from '../../../scripts/check-suppressions.mjs';
import { resolveModuleRoot } from '../../../scripts/lib/cli-entrypoint.mjs';
import { evaluateBaseline } from '../../../scripts/lib/ratchet-baseline.mjs';

describe('decideGateAction (#447: true monotonic per-rule suppression ratchet)', () => {
  it('passes when every rule count matches the baseline exactly', () => {
    const current = { total: 10, summary: { noExplicitAny: 6, useExhaustiveDependencies: 4 } };
    const baseline = { total: 10, byRule: { noExplicitAny: 6, useExhaustiveDependencies: 4 } };
    expect(decideGateAction(current, baseline)).toEqual({ action: 'PASS' });
  });

  it('fails as a REGRESSION when one rule increases even though a compensating decrease keeps the aggregate total unchanged (the exact #447 masking bug)', () => {
    const current = { total: 10, summary: { noExplicitAny: 7, useExhaustiveDependencies: 3 } };
    const baseline = { total: 10, byRule: { noExplicitAny: 6, useExhaustiveDependencies: 4 } };
    const decision = decideGateAction(current, baseline);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('REGRESSION');
    expect(decision.detail).toContain('noExplicitAny: 7 > 6');
  });

  it('fails as STALE_HIGH_BASELINE when a rule count decreases without an explicit baseline update, and its tip points at --update', () => {
    const current = { total: 9, summary: { noExplicitAny: 5, useExhaustiveDependencies: 4 } };
    const baseline = { total: 10, byRule: { noExplicitAny: 6, useExhaustiveDependencies: 4 } };
    const decision = decideGateAction(current, baseline);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('STALE_HIGH_BASELINE');
    expect(decision.tip).toContain('--update');
  });

  it('fails as NO_BASELINE_VIOLATIONS_FOUND when no baseline file exists yet and suppressions are present', () => {
    const current = { total: 3, summary: { noExplicitAny: 3 } };
    const decision = decideGateAction(current, null);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('NO_BASELINE_VIOLATIONS_FOUND');
    expect(decision.tip).toContain('--update');
  });

  it('passes with no baseline file when there are zero current suppressions', () => {
    const current = { total: 0, summary: {} };
    expect(decideGateAction(current, null)).toEqual({ action: 'PASS' });
  });

  it('fails closed as a FAIL when the baseline file itself is malformed (total disagrees with its own byRule breakdown)', () => {
    const current = { total: 10, summary: { noExplicitAny: 10 } };
    const malformedBaseline = { total: 999, byRule: { noExplicitAny: 10 } };
    const decision = decideGateAction(current, malformedBaseline);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('MALFORMED_BASELINE');
  });
});

describe('decideUpdateAction (#447: --update can never raise a per-rule ceiling)', () => {
  it('writes the new baseline when every rule holds or improves', () => {
    const current = { total: 9, summary: { noExplicitAny: 5, useExhaustiveDependencies: 4 } };
    const existing = { total: 10, byRule: { noExplicitAny: 6, useExhaustiveDependencies: 4 } };
    const decision = decideUpdateAction(current, existing);
    expect(decision).toEqual({
      action: 'WRITE',
      baseline: { total: 9, byRule: { noExplicitAny: 5, useExhaustiveDependencies: 4 } },
    });
  });

  it('refuses to write when one rule would rise even though the total falls (the exact cross-category swap this issue exists to close)', () => {
    const current = { total: 10, summary: { noExplicitAny: 7, useExhaustiveDependencies: 3 } };
    const existing = { total: 10, byRule: { noExplicitAny: 6, useExhaustiveDependencies: 4 } };
    const decision = decideUpdateAction(current, existing);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('noExplicitAny: 7 > 6');
  });

  it('refuses to write when a brand-new rule appears with a nonzero count, even though it is not in the existing baseline at all', () => {
    const current = { total: 6, summary: { noExplicitAny: 5, noThenProperty: 1 } };
    const existing = { total: 5, byRule: { noExplicitAny: 5 } };
    const decision = decideUpdateAction(current, existing);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('noThenProperty: 1 > 0');
  });

  it('allows first-time baseline creation unconditionally when no baseline exists yet', () => {
    const current = { total: 3, summary: { noExplicitAny: 3 } };
    const decision = decideUpdateAction(current, null);
    expect(decision).toEqual({
      action: 'WRITE',
      baseline: { total: 3, byRule: { noExplicitAny: 3 } },
    });
  });

  it('refuses to write when the EXISTING baseline is malformed (CodeAnt/Codex/CodeRabbit, PR #823): the original version refused only REGRESSION, so a corrupted baseline file would silently be overwritten by --update instead of failing closed', () => {
    const current = { total: 5, summary: { noExplicitAny: 5 } };
    const malformedExisting = { total: 999, byRule: { noExplicitAny: 5 } };
    const decision = decideUpdateAction(current, malformedExisting);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('MALFORMED_BASELINE');
  });

  it('refuses to write when the CURRENT live scan is malformed, not just the existing baseline (same root cause as the previous case, opposite side)', () => {
    const malformedCurrent = { total: 999, summary: { noExplicitAny: 5 } };
    const existing = { total: 5, byRule: { noExplicitAny: 5 } };
    const decision = decideUpdateAction(malformedCurrent, existing);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('MALFORMED_AUDIT');
  });

  it('still writes on the legitimate STALE_HIGH_BASELINE case (an improvement to bank) — the malformed-refusal fix must not regress the normal ratchet-down path', () => {
    const current = { total: 4, summary: { noExplicitAny: 4 } };
    const existing = { total: 5, byRule: { noExplicitAny: 5 } };
    const decision = decideUpdateAction(current, existing);
    expect(decision).toEqual({
      action: 'WRITE',
      baseline: { total: 4, byRule: { noExplicitAny: 4 } },
    });
  });
});

describe('root resolution (Sourcery/CodeAnt, PR #823: symlink-safe root, shared with audit-tokens.mjs)', () => {
  it("check-suppressions.mjs's exported root matches resolveModuleRoot computed directly for the same file, confirming it actually wired up the shared symlink-safe resolver instead of a raw path.dirname(fileURLToPath(...))", () => {
    const expected = resolveModuleRoot(
      new URL('../../../scripts/check-suppressions.mjs', import.meta.url).href,
    );
    expect(root).toBe(expected);
  });
});

describe('isValidCount safe-integer boundary (CodeAnt, PR #823)', () => {
  it('rejects a count above Number.MAX_SAFE_INTEGER even though Number.isInteger would accept it, since such a JSON value can have lost precision during parsing', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 2; // still Number.isInteger === true, not safe
    const audit = { total: unsafe, summary: { noExplicitAny: unsafe } };
    const verdict = evaluateBaseline(audit, null);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_AUDIT');
  });
});
