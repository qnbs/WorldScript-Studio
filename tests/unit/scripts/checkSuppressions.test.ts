// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decideGateAction,
  decideUpdateAction,
  root,
  withUpdateLock,
  writeBaselineAtomic,
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
    const decision = decideGateAction(current, undefined);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('NO_BASELINE_VIOLATIONS_FOUND');
    expect(decision.tip).toContain('--update');
  });

  it('passes with no baseline file when there are zero current suppressions', () => {
    const current = { total: 0, summary: {} };
    expect(decideGateAction(current, undefined)).toEqual({ action: 'PASS' });
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

  it('allows first-time baseline creation unconditionally when no baseline exists yet (existingBaseline undefined)', () => {
    const current = { total: 3, summary: { noExplicitAny: 3 } };
    const decision = decideUpdateAction(current, undefined);
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

describe('withUpdateLock (chatgpt-codex-connector, PR #823: real mutual exclusion, not a narrowed re-check window)', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the callback and returns its value when no other lock is held', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-lock-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    const result = withUpdateLock(baselinePath, () => 'done');
    expect(result).toBe('done');
  });

  it('removes the lock file after the callback completes normally', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-lock-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    withUpdateLock(baselinePath, () => {});
    expect(existsSync(`${baselinePath}.lock`)).toBe(false);
  });

  it('removes the lock file even when the callback throws (the exact bug this fix closes: process.exit() inside the callback would have skipped this cleanup)', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-lock-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    expect(() =>
      withUpdateLock(baselinePath, () => {
        throw new Error('callback failed');
      }),
    ).toThrow('callback failed');
    expect(existsSync(`${baselinePath}.lock`)).toBe(false);
  });

  it('refuses a second concurrent acquisition while the first lock is still held, proving real mutual exclusion rather than a re-check that both callers could still pass', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-lock-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    expect(() =>
      withUpdateLock(baselinePath, () => {
        // QNBS-v3: still holding the outer lock here — a second acquisition attempt for the same baselinePath must fail, simulating a second `--update` process starting mid-run.
        expect(() => withUpdateLock(baselinePath, () => {})).toThrow(/already in progress/);
      }),
    ).not.toThrow();
  });
});

describe('writeBaselineAtomic (CodeRabbit, PR #823: rename-based atomic replace)', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes valid, parseable JSON that a reader can load back exactly', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-atomic-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    const baseline = { total: 3, byRule: { noExplicitAny: 3 } };
    writeBaselineAtomic(baselinePath, baseline);
    expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual(baseline);
  });

  it('leaves no temp file behind after a successful write', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-atomic-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    writeBaselineAtomic(baselinePath, { total: 0, byRule: {} });
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('replaces an existing baseline file rather than merging or appending', () => {
    dir = mkdtempSync(join(tmpdir(), 'suppressions-atomic-'));
    const baselinePath = join(dir, 'suppressions-baseline.json');
    writeBaselineAtomic(baselinePath, { total: 5, byRule: { noExplicitAny: 5 } });
    writeBaselineAtomic(baselinePath, { total: 2, byRule: { noExplicitAny: 2 } });
    expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual({
      total: 2,
      byRule: { noExplicitAny: 2 },
    });
  });
});

describe('falsy-or-null-but-present baseline handling (Codex + CodeRabbit, PR #823, two rounds of the same class of bug)', () => {
  it('decideUpdateAction treats a baseline file that parsed to a falsy JSON scalar as malformed, not as "no baseline" — the original truthiness check would have silently overwritten it', () => {
    const current = { total: 5, summary: { noExplicitAny: 5 } };
    // QNBS-v3: `false` is what loadExistingBaseline would return if suppressions-baseline.json literally contained the 5-byte file `false` — a real, existing, malformed file, not a missing one.
    const decision = decideUpdateAction(current, false as unknown as undefined);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('MALFORMED_BASELINE');
  });

  it('decideGateAction treats the same falsy-but-present baseline as malformed rather than passing as if no baseline existed', () => {
    const current = { total: 5, summary: { noExplicitAny: 5 } };
    const decision = decideGateAction(current, 0 as unknown as undefined);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('MALFORMED_BASELINE');
  });

  it('decideUpdateAction treats a baseline file that parsed to literal JSON null as malformed too (fresh evidence, PR #823 round 2): JSON.parse("null") returns the exact same null value a naive check could otherwise collide with the "no baseline" sentinel', () => {
    const current = { total: 5, summary: { noExplicitAny: 5 } };
    const decision = decideUpdateAction(current, null as unknown as undefined);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('MALFORMED_BASELINE');
  });

  it('decideGateAction treats the same literal-null baseline as malformed rather than passing as if no baseline existed', () => {
    const current = { total: 5, summary: { noExplicitAny: 5 } };
    const decision = decideGateAction(current, null as unknown as undefined);
    expect(decision.action).toBe('FAIL');
    expect(decision.reason).toBe('MALFORMED_BASELINE');
  });

  it('decideUpdateAction allows genuine first-time creation only when existingBaseline is actually undefined — the real "no file" sentinel, distinct from every parsed-content case above', () => {
    const current = { total: 3, summary: { noExplicitAny: 3 } };
    expect(decideUpdateAction(current, undefined)).toEqual({
      action: 'WRITE',
      baseline: { total: 3, byRule: { noExplicitAny: 3 } },
    });
  });
});

describe('decideUpdateAction refuses a malformed current scan even on first-time creation (CodeRabbit, PR #823)', () => {
  it('refuses MALFORMED_AUDIT before ever reaching the existingBaseline branch', () => {
    const malformedCurrent = { total: 999, summary: { noExplicitAny: 5 } };
    const decision = decideUpdateAction(malformedCurrent, undefined);
    expect(decision.action).toBe('REFUSE');
    expect(decision.message).toContain('MALFORMED_AUDIT');
  });
});

describe('evaluateBaseline prototype-property safety (Codex, PR #823)', () => {
  it('does not read an inherited Object.prototype property when a ruleId is absent as an OWN key on one side, correctly flagging it as a regression instead of silently treating it as 0 vs 0', () => {
    const audit = { total: 0, summary: {} };
    const baseline = { total: 1, summary: { constructor: 1 } };
    const verdict = evaluateBaseline(audit, baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('STALE_HIGH_BASELINE');
    expect(verdict.detail).toContain('constructor: 0 < 1');
  });

  it('flags a regression on a rule name that collides with an inherited property when it appears only in the current audit', () => {
    const audit = { total: 1, summary: { toString: 1 } };
    const baseline = { total: 0, summary: {} };
    const verdict = evaluateBaseline(audit, baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('REGRESSION');
    expect(verdict.detail).toContain('toString: 1 > 0');
  });
});
