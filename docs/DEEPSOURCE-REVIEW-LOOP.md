# DeepSource Review Correction Loop

> **Living runbook — complementary to [`CODEANT-REVIEW-LOOP.md`](CODEANT-REVIEW-LOOP.md).**
> DeepSource is a second, **token-free** static-analysis layer (see [`.deepsource.toml`](../.deepsource.toml)),
> added because the CodeAnt CI Action requires an account-bound token the free tier will not issue.
> This file is the single source of truth for working DeepSource findings. **Keep it current** —
> append to the *Observed behaviour log* (§11) every time DeepSource does something new on this repo.

## 0. Status & when this runs

- **Activation:** DeepSource analyses a branch once [`.deepsource.toml`](../.deepsource.toml) is on it
  **and** the free DeepSource GitHub App is installed (https://app.deepsource.com, free for OSS).
  Once the config is on `main`, every PR and `main` itself are analysed automatically.
- **Standing rule (like the CodeAnt loop):** the moment an open PR has DeepSource findings, work them
  **without being asked**. Goal state: **DeepSource checks green** (or every finding fixed/justified)
  with the rest of CI green.

## 0a. AI Review is NOT available on this account — do not trigger it

DeepSource has **two** layers:

- **Static analysis** (per-analyzer check-runs `DeepSource: JavaScript / Rust / Docker`; `CSS` is
  AI-only) — **automatic on every push, free, reliable.** This is the **operative** layer; the entire
  loop below runs on it.
- **AI Review** (LLM-based, triggered by `@deepsourcebot review`) — requires **AI Agents**
  (dashboard → Policies → AI), a **paid / team feature not on the free OSS tier.**

> **Verified 2026-06-24:** triggering `@deepsourcebot review` on three PRs produced **zero response**
> (no comment; the AI-only CSS analyzer stayed `skipped`), and the "Enable AI Agents" toggle is not
> even present on the free plan. **So do NOT post `@deepsourcebot review`** — it is a no-op that only
> adds a dead comment. Run the correction loop on the **static-analysis** findings + the dashboard
> categories. **If the account ever upgrades** to include AI Review, re-introduce the per-PR trigger
> and fold its findings into the loop.

## 1. How DeepSource differs from the CodeAnt loop (read first)

| Aspect | CodeAnt | DeepSource |
|---|---|---|
| Trigger | manual `@codeant-ai review` per push | **static**: auto on every push (the operative layer) · **AI review**: paid feature, unavailable on the free tier — not triggered (§0a) |
| Where findings appear | GitHub **review threads** (resolvable) | **check-run annotations** (per file/line) + the DeepSource **dashboard**; *not* review threads |
| Resolution mechanism | reply + `resolveReviewThread` (GraphQL) | **fix the code** (check goes green) · `# skipcq` inline · or "Ignore" in the dashboard |
| Suppression token | `// biome-ignore` | `# skipcq: <ISSUE_CODE>` / `// skipcq: <ISSUE_CODE>` |
| Per-language split | one review | one **check per analyzer** (`DeepSource: JavaScript`, `Rust`, `Docker`, `CSS`, …) |
| Autofix | — | **dashboard-driven** — opens its own PR (review it like any PR) |

**Consequence:** there is **no `resolveReviewThread` step** here. You make a check green by fixing the
code (preferred), by a justified `# skipcq`, or by ignoring it in the dashboard. The **static**
re-analysis re-runs **automatically on every push** — no trigger comment is needed (and the on-demand
AI review is a paid feature that is unavailable on this account; see §0a).

## 2. The Iron Rule — loop until quiescent

A push that fixes findings triggers a **fresh** DeepSource run, which can surface **new** findings
caused by the fix (a "wave"). Handle each wave like the first.

```
        ┌─────────────────────────────────────────────┐
        │ 1. Fetch DeepSource findings (check-runs +   │
        │    annotations) for the PR head SHA          │
        │ 2. Validate each against CURRENT code        │
        │ 3. Fix root cause  OR  justify (# skipcq /   │
        │    dashboard-ignore, with reason)            │
        │ 4. Update tests + i18n + docs (lockstep)     │
        │ 5. suppressions + lint + typecheck + vitest  │
        │ 6. Commit + push (one wave = one commit)     │
        │ 7. static re-runs AUTOMATICALLY on push      │
        └───────────────┬─────────────────────────────┘
                        │ new findings?
              ┌── yes ──┘         └── no ──┐
              ▼                            ▼
        (next wave, go to 1)        DONE → merge when CI green
```

> **Termination condition:** the latest DeepSource run reports **no new actionable findings** and
> every prior finding is fixed or justified. Then merge once all CI is green.

## 3. Fetch DeepSource findings from the CLI

DeepSource posts one check-run per analyzer on the PR **head SHA**. List them, then pull annotations.

```bash
SHA=$(gh pr view PR_NUMBER --json headRefOid --jq '.headRefOid')

# 3a. Per-analyzer check-run conclusions
gh api repos/qnbs/WorldScript-Studio/commits/$SHA/check-runs \
  --jq '.check_runs[] | select((.name//"")|test("DeepSource")) | "\(.id)\t\(.name)\t\(.conclusion // .status)"'

# 3b. The actual findings (annotations: path, line, level, message) for a failing/neutral check
gh api repos/qnbs/WorldScript-Studio/check-runs/<CHECK_RUN_ID>/annotations \
  --jq '.[] | "\(.path):\(.start_line) [\(.annotation_level)] \(.message)"'

# 3c. Summary text DeepSource attaches to the check (issue counts, links)
gh api repos/qnbs/WorldScript-Studio/check-runs/<CHECK_RUN_ID> \
  --jq '.output | "\(.title)\n\(.summary)"'
```

The **DeepSource dashboard** (https://app.deepsource.com → repo → Issues) is the richest view —
issue code (e.g. `JS-0123`), category, occurrences, and the one-click **Autofix**/**Ignore** buttons.
The CLI annotations above are enough for the agent loop; use the dashboard for triage at scale.

## 4. Validate, then fix or justify

For **each** finding (same discipline as the CodeAnt loop):

- **Validate against the *current* code** — annotations can lag a force-push.
- **If valid → real root-cause fix** (code **+ tests + i18n + docs**), never a band-aid.
- **If a false positive / by-design →** justify. Two honest options:
  - **`# skipcq: <ISSUE_CODE>`** inline, immediately above the line, **with a reason comment**, e.g.
    `// skipcq: JS-0323  reason: intentional any at the worker-protocol boundary (typed downstream)`.
  - **Dashboard → Ignore** (ignore-for-file / ignore-rule / ignore-test-only) when the rule is noisy
    for a whole category — record the decision in §11 so it is not silently lost.
- **No scope creep** — fix the finding, not unrelated code.

### 4a. Suppression interactions — two separate ratchets

1. **`# skipcq` is *not* `biome-ignore`.** The project ratchet (`scripts/check-suppressions.mjs`)
   text-matches `biome-ignore`/`eslint-disable`; it does **not** currently count `skipcq`. So a
   `skipcq` does not raise that baseline — **but** do not reach for it reflexively; a root-cause fix
   is still preferred, and a growing `skipcq` count is its own (dashboard-tracked) debt.
2. **Naïve-match foot-gun (learned 2026-06-24):** `check-suppressions.mjs` matches the *literal*
   strings — a code **comment that merely mentions** `biome-ignore`/`eslint-disable` is counted and
   **fails the ratchet**. When documenting suppressions in code comments, do **not** write the literal
   token (paraphrase: "a lint suppression"). The same applies if you reference `skipcq` near ratchet
   tooling later.
3. **Never silence a real bug** to make a check green. If DeepSource and Biome disagree on a rule,
   prefer the repo's existing convention and ignore the DeepSource rule at the **config** level
   (`.deepsource.toml`) rather than scattering inline `skipcq`s.

## 5. Configuration — [`.deepsource.toml`](../.deepsource.toml)

- **Analyzers:** `javascript` (`dialect = "typescript"`, React plugin). DeepSource also
  **auto-detects** and runs `Rust`, `Docker`, and `CSS` analyzers on this repo (observed) — they need
  no entry to run, but can be tuned/excluded in the toml.
- **No `[[transformers]]` block** — deliberately. DeepSource's formatting transformers (Prettier,
  etc.) would **fight Biome** (the repo formatter) and create churn. Formatting is owned by Biome;
  DeepSource is analysis-only.
- **`exclude_patterns`** keep generated bundles (`public/locales/**`), the vendored `collab-transport`
  fork, build output, `.tsx.html` render dumps, and `src-tauri/target` out of analysis.
- **`test_patterns`** mark `tests/**` + `*.test.ts(x)` so test-only rules apply correctly.
- **No coverage analyzer** — `test-coverage` needs a CI token (the same blocker as the CodeAnt
  Action). Coverage stays owned by Vitest's thresholds in `vitest.config.ts`.

When adding a heavy generated/vendored path elsewhere, add it to `exclude_patterns` to keep first-run
noise down.

## 6. Autofix (dashboard-driven)

DeepSource **Autofix** is triggered from the dashboard, not the toml. It opens a **separate PR** with
the mechanical fix. Treat that PR like any other: review the diff, run the local gate, ensure it does
not undo a Biome convention, then merge or close. Do **not** auto-trust Autofix on security/logic
issues — read the change.

## 7. Local quality gate (low-end hardware — sequential, never parallel)

Identical to the CodeAnt loop — **one** heavy command per step (OOM guard):

```bash
node scripts/check-suppressions.mjs            # [suppressions] OK
pnpm run lint                                  # biome --error-on-warnings → 0
pnpm run typecheck                             # tsgo → 0
pnpm run i18n:check                            # only if user-facing strings changed
pnpm exec vitest run <affected test files>     # targeted, not the whole suite
```

Coverage, E2E, Lighthouse, Stryker, Storybook are **CI-only**.

## 8. Commit & push (DeepSource re-runs automatically)

```bash
git add -A
git commit -m "refactor(scope): address DeepSource wave N (<issue codes>)"
git push origin <feature-branch>
```

End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
**No manual re-trigger** — DeepSource analyses the new head SHA on its own. Wait for the fresh run,
then go back to §3.

## 9. Merge

Once DeepSource is quiescent **and** all CI is green:

- Prefer **auto-merge (squash)**: `gh pr merge PR_NUMBER --auto --squash --delete-branch`.
- Admin squash-merge is acceptable **only after** CI is green and the loop is quiescent, e.g. if
  branch protection leaves the PR `BLOCKED` despite green required checks
  (`gh pr merge PR_NUMBER --squash --admin --delete-branch`).
- **Never** admin-merge while CI is running or red.
- If a DeepSource check is configured as **required** and is legitimately green/neutral, it gates
  merge normally; if it is *informational* (not required) it does not block — confirm which via the
  required-checks list on the head SHA before merging.

## 10. Relationship to CodeAnt

DeepSource **complements**, not replaces, CodeAnt. When the CodeAnt free-tier quota resets and its
GitHub App resumes auto-reviewing, run **both** loops: CodeAnt for narrative/AI review threads
(`CODEANT-REVIEW-LOOP.md`), DeepSource for deterministic static-analysis checks (this file). A PR is
"review-quiescent" only when **both** are green/0-unresolved.

## 11. Observed behaviour log (append-only — keep this honest)

> Update this every time DeepSource surprises us. Dates are absolute.

- **2026-06-24** — DeepSource App installed mid-rollout. On PR #227 (the config PR) it posted four
  check-runs on the head SHA: `DeepSource: JavaScript` (success), `DeepSource: Rust` (success),
  `DeepSource: Docker` (success), `DeepSource: CSS` (skipped). So it **auto-detects Rust/Docker/CSS**
  beyond the single `javascript` analyzer declared in the toml. Findings are check annotations, not
  review threads. Autofix enabled by the maintainer (dashboard-driven). First full-codebase pass will
  land when the config reaches `main`.
- **2026-06-24** — Repo-wide triage done off the **static** layer (dashboard categories via WebFetch):
  Security clean (JS-0440 dashboard-ignored, reviewed-safe), ~1700 anti-patterns + bug-risk almost all
  rule-ignored as deliberate-convention/Biome/strict-TS/test false-positives (void/any/non-null/console/
  async-no-await/…), Performance + Documentation **0**. Genuine fixes: ecoModeService boolean (#230),
  Storybook rules-of-hooks (#231), PDF-iframe sandbox (#232). **AI review never responded** to
  `@deepsourcebot review` on #231/#232/#233 (no post-trigger comment; CSS analyzer stayed skipped) →
  AI Agents off / not on the OSS free tier. **Conclusion (#233):** AI Review is a paid feature
  unavailable here — **stop triggering it** and gate merges on the **static** layer's quiescence
  (§0a). Re-introduce the per-PR trigger only if the account is upgraded to include AI Agents.

---

### Quick reference

| Purpose | Command / location |
|---|---|
| List DeepSource checks for a PR | `gh api repos/qnbs/WorldScript-Studio/commits/$SHA/check-runs --jq '.check_runs[]\|select(.name\|test("DeepSource"))'` |
| Read a check's findings | `gh api repos/qnbs/WorldScript-Studio/check-runs/<ID>/annotations` |
| Triage / Autofix / Ignore | https://app.deepsource.com → repo → Issues |
| Suppress one finding | `# skipcq: <ISSUE_CODE>  reason: …` (inline, above the line) |
| Config | [`.deepsource.toml`](../.deepsource.toml) |

**Owner/repo:** `qnbs` / `WorldScript-Studio`.
