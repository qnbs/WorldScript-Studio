# DeepSource Remediation Plan (living tracker)

> **Purpose:** a single place to plan and execute the working-down of *all* DeepSource findings on
> `WorldScript-Studio`. Pairs with the process doc [`DEEPSOURCE-REVIEW-LOOP.md`](DEEPSOURCE-REVIEW-LOOP.md)
> (the *how*); this file is the *what* + *in what order* + *done?*. **Append-only status; keep honest.**
>
> **Report (maintainer-only, auth-gated):**
> https://app.deepsource.com/report/dc0f6a04-21cb-423c-8906-fe1408726a37
> The agent cannot read the dashboard (login-gated). Findings tables below are **seeded with the
> structure + known hotspots** and are filled from: (a) per-PR check annotations (`gh api …/annotations`),
> (b) a maintainer paste/CSV-export of the dashboard Issues list, or (c) on-demand `@deepsourcebot review`.

## 0. Current state (2026-06-24)

- DeepSource App installed; analysers active on the repo: **JavaScript** (TS dialect + React),
  **Rust**, **Docker**, **CSS** (CSS is AI-only → only runs on `@deepsourcebot review`).
- PR #227 (config + runbook) scored **Grade A** (trivial diff). The **repo-wide baseline** (the report
  URL above) is the real backlog — visible only in the maintainer's dashboard until populated here.
- Static analysis runs automatically on every push; **AI Review is on-demand** (`@deepsourcebot review`).

## 0a. Reports digest (populated from maintainer-shared report pages)

- **CWE/SANS Top 25** (created 2026-06-24): **0 occurrences across all 25 Top-25 CWE rows.** Report
  **Status: Failing · Active Issues: 1** — the single active issue is **`JS-0440`** (Security/Major,
  `dangerouslySetInnerHTML`, mapped to **CWE-937 / OWASP**, not a Top-25 CWE row → hence "1 active"
  with all rows still 0). `pnpm audit` = 0 vulns (it was **not** a 3rd-party vuln, as first guessed).
  **Resolution = dashboard "Ignore" (reviewed-safe)** — an in-code `# skipcq` does **not** attach to a
  JSX *attribute* issue (proven on PR #228: the issue sits on the `dangerouslySetInnerHTML=` line and
  JSX forbids a comment between attributes; DeepSource reads only the immediately-preceding line). See
  the P0 row + §4b. Once ignored, the CWE/SANS report flips to **Passing**.
- _(OWASP Top 10 / MISRA C / Issue Distribution / 3rd-party vulns: paste when available.)_

## 1. Prioritisation framework (work top-down)

Fix in this order — highest user/security impact first; cosmetic last. Within a tier, do the
**highest-occurrence / highest-risk-file** issues first.

| Pri | Category (DeepSource) | Why first | Default action |
|-----|----------------------|-----------|----------------|
| **P0** | **Security** (`SEC-`, secrets, injection, crypto) | exploitable; matches repo's security-first CI | fix root cause; never `skipcq` a real one |
| **P1** | **Bug-risk / Reliability** (`-W` correctness, null/undefined, async, React hooks) | real defects; aligns with strict-TS guarantees | fix; add/adjust a unit test in lockstep |
| **P2** | **Performance** (`-P`, needless re-render, sync-in-loop) | UX on low-end target hardware | fix where measured-meaningful; else log + defer |
| **P3** | **Anti-pattern** (`-A`) | maintainability; some overlap with Biome | fix; if it conflicts with an established repo convention → **config-ignore** at `.deepsource.toml`, not inline |
| **P4** | **Hygiene / Style** (`-S`/`-C`) | mostly owned by **Biome** already | prefer config-ignore the whole rule (avoid churn that fights Biome formatting) |
| **P5** | **Documentation** (`-D`) | lowest impact | batch-fix or ignore-rule; do not block features |

**Coverage** is intentionally **out of scope** here — owned by Vitest thresholds in `vitest.config.ts`
(DeepSource coverage needs a token we cannot issue on the free tier).

## 2. Execution model

- **Batch by category, then by module/file** — one focused PR per batch, each **< ~100 files**
  (i18n fan-out rules from the CodeAnt runbook apply). Title e.g. `fix(deepsource): P1 bug-risk batch — async/null guards`.
- **Lockstep:** every code fix updates tests + i18n + docs as needed (repo modus operandi).
- **Loop discipline:** follow [`DEEPSOURCE-REVIEW-LOOP.md`](DEEPSOURCE-REVIEW-LOOP.md) — push → DeepSource
  re-runs automatically → handle the new wave → repeat until quiescent → merge on green CI.
- **Suppression discipline:** prefer root-cause fix. A justified `# skipcq: <CODE>  reason: …` is
  acceptable for true false-positives; a *whole-rule* disagreement (esp. style rules that fight Biome)
  → ignore at the **`.deepsource.toml`** level. Never write the literal `biome-ignore`/`eslint-disable`
  token in a comment (it trips `scripts/check-suppressions.mjs`'s naïve text match).
- **Do not** let DeepSource remediation derail the in-flight v2.0 program (Settings/Help → i18n+LT
  addition). Interleave: clear P0/P1 promptly; schedule P3–P5 batches between feature PRs.

## 3. Findings inventory — TO BE POPULATED

> Fill one row per distinct issue code. Source the counts/files from the dashboard or per-PR
> annotations. `Decision` ∈ {fix · skipcq+reason · config-ignore · dashboard-ignore}. `Status` ∈
> {todo · in-progress · done · wontfix}.

### P0 — Security
| Issue code | Title | Occ. | Files / modules | Decision | Status | PR |
|---|---|---|---|---|---|---|
| CWE/SANS Top-25 rows | code-level Top-25 CWE violations | **0** | — | none needed (clean) | done | — |
| **JS-0440** | Avoid dangerous JSX props — `dangerouslySetInnerHTML` (CWE-937 / OWASP; the report's "1 active") | 1 | `components/HelpView.tsx:125` | **dashboard "Ignore" (reviewed-safe)** — `__html` is `DOMPurify.sanitize()`d (repo's documented safe pattern); not a real XSS. In-code `skipcq` can't attach to a JSX attribute (§4b). | maintainer-click | — |

### P1 — Bug-risk / Reliability
| Issue code | Title | Occ. | Files / modules | Decision | Status | PR |
|---|---|---|---|---|---|---|
| _(populate)_ | | | | | | |

### P2 — Performance
| Issue code | Title | Occ. | Files / modules | Decision | Status | PR |
|---|---|---|---|---|---|---|
| _(populate)_ | | | | | | |

### P3 — Anti-pattern
| Issue code | Title | Occ. | Files / modules | Decision | Status | PR |
|---|---|---|---|---|---|---|
| **JS-0323** | Detected usage of `any` (Critical) | 34 / 20 files | **100% test files** (browser-API mocks: MediaRecorder/AudioContext …), all already `biome-ignore noExplicitAny`'d; **0 production** | **rule-ignore, test scope** — redundant with Biome `noExplicitAny` + the suppression ratchet (baseline 52). Do NOT add 34 inline `skipcq`. Long-term: opportunistic typed-mock cleanup (§4c). | maintainer-click (rule-ignore) | — |
| **JS-0415** | JSX tree too deeply nested (5–6 levels) | 2 | `components/HelpView.tsx` | pre-existing structural; genuine refactor candidate (extract sub-components to cut nesting). Minor severity → schedule as a low-priority hygiene PR; **not** a false positive. | todo (future refactor) | — |

### P4 — Hygiene / Style
| Issue code | Title | Occ. | Files / modules | Decision | Status | PR |
|---|---|---|---|---|---|---|
| _(populate)_ | | | | | | |

### P5 — Documentation
| Issue code | Title | Occ. | Files / modules | Decision | Status | PR |
|---|---|---|---|---|---|---|
| _(populate)_ | | | | | | |

## 4. Likely hotspots (unverified — confirm against the real report)

Informed predictions from the codebase, to triage faster once findings land. **Not authoritative.**

- **`any` / type-escape findings (JS bug-risk/anti-pattern):** the repo carries **52 `biome-ignore`
  suppressions** (mostly `noExplicitAny` at worker/test boundaries). DeepSource will likely flag the
  same sites (e.g. `JS-0323` "avoid `any`"). Decision skew: worker-protocol/test boundaries →
  `# skipcq`+reason or config-ignore in test paths; production `any` → real fix where feasible.
- **React hooks deps / re-render (JS):** exhaustive-deps and re-render rules — cross-check against the
  repo's deliberate ResizeObserver/layout-trigger patterns (CLAUDE.md notes Biome exhaustive-deps
  exceptions); config-ignore where the deviation is intentional and documented.
- **Rust (`src-tauri/`):** clippy-style findings on the Tauri backend; no PR-CI gate historically →
  verify via `tauri-build.yml`. Low traffic.
- **Docker:** `Dockerfile`/compose hardening hints (pinned tags, non-root) — quick P4 batch.
- **Test files:** noise-prone; ensure `test_patterns` in `.deepsource.toml` scopes test-only rules so
  they don't inflate the backlog.

### 4b. In-code `skipcq` does NOT attach to JSX-attribute issues (proven on PR #228)

DeepSource reads a `skipcq` only on the issue's line or the **immediately preceding** line. For an
issue on a **JSX attribute** (e.g. `dangerouslySetInnerHTML=` / JS-0440), you cannot place a comment
between attributes, and a `{/* skipcq */}` before the element is too far up — so it never attaches
(verified: #228's skipcq left JS-0440 still failing, and *modifying* the file made DeepSource attribute
the file's pre-existing issues as "introduced", failing the JS check). **Rules:**
- For a **statement-level** issue → `// skipcq: <CODE>  reason: …` on the line directly above works.
- For a **JSX-attribute** issue → use the **dashboard "Ignore"** (or refactor the value into a
  statement/const where a `// skipcq` can attach). Do **not** churn the file just to add a skipcq —
  touching a file surfaces its whole backlog as "introduced".

### 4c. Long-term: retire the `any` test-mock suppressions (optional code-health track)

Confirmed: the `noExplicitAny` suppressions are **0 in production, all in 20 test files** (browser-API
mocks). Eliminating them is **recommendable mid/long-term but low-priority** (test-only; no ship risk).
Highest-leverage approach: a shared typed-mock helper (e.g. `tests/helpers/browserMocks.ts`) with
typed factories for the recurring mocks (MediaRecorder, AudioContext, …), then migrate files
incrementally, **dropping the ratchet baseline by 1 each time** and using `as unknown as T` for the
irreducible constructor/private-field cases. Benefits: lowers the ratchet (health-trend signal),
removes JS-0323 at the source (no rule-ignore needed), catches mock-drift. Do it opportunistically
between features — never as a blocking mega-PR.

## 5. Config-level decisions (record every rule we ignore wholesale)

When a DeepSource rule conflicts with an established repo convention or with Biome, ignore it at the
config level (`.deepsource.toml`) instead of scattering inline `skipcq`. Log each here with rationale.

| Rule / analyzer | Action | Rationale | Date |
|---|---|---|---|
| **JS-0323** (`any`) | dashboard rule-ignore, **test-file scope** | 34 occ all in test mocks, already governed by Biome `noExplicitAny` + the suppression ratchet (baseline 52); double-suppressing is noise. 0 production `any`. Long-term cleanup → §4c. | 2026-06-24 |
| **JS-0440** (`dangerouslySetInnerHTML`) | dashboard "Ignore" (single occurrence) | reviewed-safe — `__html` is DOMPurify-sanitized (repo policy). In-code skipcq can't attach to a JSX attribute (§4b). | 2026-06-24 |

## 6. Definition of done

- DeepSource dashboard backlog triaged: every issue code has a row + a Decision here.
- All **P0/P1** issues **fixed** (0 open) with tests in lockstep.
- P2–P5 either fixed, justified `skipcq`, or a logged config-ignore — **no silent open items**.
- `.deepsource.toml` reflects all wholesale rule decisions (§5).
- Repo grade tracked over time in §0; target: hold **A** on new PRs, drive the baseline up.

## 7. Input needed to make this concrete (maintainer, 2 min)

Pick one — then the agent populates §3 precisely and starts the batches:

1. **Easiest:** dashboard → repo → **Issues** → **Export** (CSV) → paste/attach. Or
2. Paste the **per-category counts** (Security / Bug-risk / Performance / Anti-pattern / Style / Docs)
   and the **top ~15 issue codes** with occurrence counts. Or
3. Just say "go per-PR" — the agent then logs findings here from each PR's DeepSource annotations as
   they appear, no upfront dump (slower to a full backlog view, but zero maintainer effort).
