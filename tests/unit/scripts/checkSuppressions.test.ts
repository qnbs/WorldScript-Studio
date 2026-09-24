// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decideGateAction, decideUpdateAction } from '../../../scripts/check-suppressions.mjs';

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
});
