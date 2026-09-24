// QNBS-v3: shared by scripts/audit-tokens.mjs and scripts/check-suppressions.mjs so the true monotonic per-rule ratchet (post-Visual qualification tranche, Section 3.2; extended to suppressions by #447) is one audited implementation, not two copies that can drift apart.

function sumSummary(summary) {
  return Object.values(summary).reduce((sum, count) => sum + count, 0);
}

// QNBS-v3 (Codex, PR #817; hardened by CodeAnt, PR #823): a violation count can only ever be a non-negative whole number — this is checked explicitly, before any arithmetic, so a malformed JSON value (a string, NaN/Infinity, a fraction, or a negative number) can never reach sumSummary's '+' or the ratchet loop's '>'/'<', whose implicit type coercion could otherwise let a corrupted value slip through as if it matched. Number.isSafeInteger, not Number.isInteger — a JSON count above Number.MAX_SAFE_INTEGER can lose precision during parsing and still report Number.isInteger === true, producing an unreliable ratchet comparison against a value that was silently rounded.
function isValidCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// QNBS-v3: validates both `total` and every `summary` value in one call, shared by the audit-side and baseline-side checks in evaluateBaseline so both are held to the identical numeric contract.
function hasValidCounts(candidate) {
  // QNBS-v3 (Codex, PR #817): summary must be a Record<string, number>, never an array — typeof [] === 'object' in JS, so without this explicit check an empty array (Object.values([]) is vacuously []) or an array shape entirely would silently pass as "valid" and reach sumSummary's arithmetic.
  if (
    !candidate ||
    typeof candidate.summary !== 'object' ||
    candidate.summary === null ||
    Array.isArray(candidate.summary)
  ) {
    return false;
  }
  if (!isValidCount(candidate.total)) return false;
  return Object.values(candidate.summary).every(isValidCount);
}

/**
 * A true monotonic per-rule ratchet. Every rule's count must equal its baselined count exactly —
 * an increase is a REGRESSION, and a decrease is also rejected (STALE_HIGH_BASELINE), because
 * leaving the baseline stale-high would let the count silently regrow back up to the old ceiling
 * in a later, unrelated change. An explicit baseline update is the only way to accept a new
 * ceiling in either direction. Exported so tests can exercise every outcome without shelling out
 * to the real script or touching real files.
 */
export function evaluateBaseline(audit, baseline) {
  // QNBS-v3 (Sourcery, PR #817): a malformed live audit must fail closed before the no-baseline branch gets a chance to short-circuit past it — checked first, unconditionally, so a missing baseline can never mask it.
  if (!hasValidCounts(audit)) {
    return {
      ok: false,
      reason: 'MALFORMED_AUDIT',
      detail: 'audit.total and every audit.summary value must be finite non-negative integers',
    };
  }
  const auditSum = sumSummary(audit.summary);
  if (auditSum !== audit.total) {
    return {
      ok: false,
      reason: 'MALFORMED_AUDIT',
      detail: `audit.total (${audit.total}) !== sum(audit.summary) (${auditSum})`,
    };
  }

  if (!baseline) {
    return audit.total > 0
      ? { ok: false, reason: 'NO_BASELINE_VIOLATIONS_FOUND' }
      : { ok: true, reason: 'NO_BASELINE_NO_VIOLATIONS' };
  }

  // QNBS-v3 (Sourcery, PR #817): a baseline with no valid summary object must fail closed rather than being silently normalized to {} and ratcheted against as if it were a real, empty baseline.
  if (!hasValidCounts(baseline)) {
    return {
      ok: false,
      reason: 'MALFORMED_BASELINE',
      detail:
        'baseline.total and every baseline.summary value must be finite non-negative integers',
    };
  }
  // QNBS-v3: a malformed baseline (its own stored total disagreeing with its own per-rule breakdown) must fail closed rather than silently ratchet against a number that was never actually true.
  const baselineSum = sumSummary(baseline.summary);
  if (baselineSum !== baseline.total) {
    return {
      ok: false,
      reason: 'MALFORMED_BASELINE',
      detail: `baseline.total (${baseline.total}) !== sum(baseline.summary) (${baselineSum})`,
    };
  }

  const allRuleIds = new Set([...Object.keys(audit.summary), ...Object.keys(baseline.summary)]);
  const regressions = [];
  const staleHigh = [];
  // QNBS-v3 (Codex, PR #823): Object.hasOwn, not bracket-index + `?? 0` — a ruleId present as an OWN key on one summary but absent from the other would otherwise read the OTHER summary's inherited Object.prototype property (e.g. ruleId "constructor" resolves to Object.prototype.constructor, not undefined), so `?? 0` never triggers and the numeric comparison silently evaluates false in both directions, hiding a real regression.
  for (const ruleId of allRuleIds) {
    const current = Object.hasOwn(audit.summary, ruleId) ? audit.summary[ruleId] : 0;
    const baselined = Object.hasOwn(baseline.summary, ruleId) ? baseline.summary[ruleId] : 0;
    if (current > baselined) regressions.push(`${ruleId}: ${current} > ${baselined}`);
    else if (current < baselined) staleHigh.push(`${ruleId}: ${current} < ${baselined}`);
  }

  if (regressions.length > 0) {
    return { ok: false, reason: 'REGRESSION', detail: regressions.join(', ') };
  }
  if (staleHigh.length > 0) {
    return { ok: false, reason: 'STALE_HIGH_BASELINE', detail: staleHigh.join(', ') };
  }
  return { ok: true, reason: 'EXACT_MATCH' };
}

export { hasValidCounts, isValidCount, sumSummary };
