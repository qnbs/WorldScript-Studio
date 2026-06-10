# Coverage Ratchet Policy

Single source of truth for **when and how Vitest coverage thresholds change** (audit finding F-9).
The thresholds themselves live in [`vitest.config.ts`](../vitest.config.ts) (`coverage.thresholds`);
this document is the *policy* around them.

## Why this exists

Coverage thresholds were once set **above** the value CI actually measured (target
`L76/F68/B61/S74` that was "never actually met on CI"), which inverts the gate: every run that
should pass goes red, and the only "fix" is to lower the bar. That correction loop (`L72/F64/B58/S70`,
2026-05-31) is the failure mode this policy prevents. A threshold must always sit **below** the
measured value, with a margin that absorbs run-to-run variance (Node 22 vs 24, flaky branch counting).

## The rule

1. **Never lower a threshold to make CI green** (hard rule HR-1). A drop in measured coverage is a
   signal to add tests, not to move the goalpost. The only legitimate decrease is removing a metric
   that no longer applies (e.g. excluding generated/vendored code from the denominator — document it
   in the `vitest.config.ts` comment).
2. **Ratchet up at most once per minor release.** After a release's tests land and CI reports stable
   numbers, raise each threshold to **(CI-measured − 1 to 2 points)**. The margin is mandatory; do
   not set a threshold equal to or above the measured value.
3. **Measure on CI, not locally.** Full coverage (`vitest run --coverage`) is RAM-heavy and is a
   CI-only job on constrained hardware. Take the authoritative numbers from the CI `quality` job /
   Codecov, never from a local partial run.
4. **Record the move.** Every change to `coverage.thresholds` updates the history comment in
   `vitest.config.ts` with the date, the CI-measured value it was derived from, and the new floor.

## Current state (2026-06-09)

| Metric | Threshold (floor) | CI-measured (last full run) | Margin |
|--------|-------------------|-----------------------------|--------|
| Lines | 74 | 76.59 | ~2.6 |
| Statements | 72 | 74.60 | ~2.6 |
| Functions | 67 | 69.08 | ~2.1 |
| Branches | 60 | 62.31 | ~2.3 |

**P1 stretch target:** `L85 / B75 / F80` — reached by ratcheting per the rule above, never by a
one-time jump that would risk inverting the gate again.

## Procedure for the next ratchet

1. Merge the release's test additions; let CI run the full coverage matrix (Node 22 + 24).
2. Read the lower of the two nodes' measured values per metric.
3. Set each threshold to `floor(measured − 1.5)`.
4. Update the `vitest.config.ts` history comment (date + source value + new floor).
5. Open the bump in its own commit so the ratchet is auditable: `test(coverage): ratchet thresholds → …`.

> Related: the suppression-debt ratchet ([`scripts/check-suppressions.mjs`](../scripts/check-suppressions.mjs),
> `suppressions-baseline.json`) follows the same monotonic principle for `biome-ignore` counts —
> baseline may only fall. Vendored-dependency CVE process: [`VENDOR-FORKS.md`](../VENDOR-FORKS.md).
