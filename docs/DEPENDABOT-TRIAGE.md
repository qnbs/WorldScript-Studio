# Dependabot Triage Strategy

How WorldScript Studio reviews and merges Dependabot PRs. Written 2026-08-20 after a real incident
(below) showed that patch-level auto-merge isn't safe when a single upstream release spans multiple
independently-versioned references in this repo. Every Dependabot PR now gets manual review before
merging — there is no auto-merge path anymore.

---

## The incident that shaped this policy

On 2026-08-20, `github/codeql-action` released v4.37.7. Dependabot opened **four separate PRs**
(#410, #413, #416, #418), one per `uses:` subpath this repo references
(`init`, `autobuild`, `analyze`, `upload-sarif`) — each is a distinct dependency from Dependabot's
point of view, even though they all live in one upstream repo and must be version-locked together.

The previously-existing `dependabot-automerge.yml` workflow auto-merged all four independently the
moment each one's own CI went green, because each is a textbook semver-patch bump. Merging **any
one** of them alone breaks CI: `github/codeql-action/analyze` hard-fails with `Loaded a
configuration file for version X, but running version Y` if its pinned version differs from
`init`'s — confirmed on PR #410's own CI run before it was caught.

**Fix applied:**
1. All four PRs closed; the four references bumped together in one manual commit.
2. `.github/dependabot.yml`'s `github-actions` entry now has a `codeql-action` group
   (`github/codeql-action*`) so a future `codeql-action` release opens **one** PR touching all
   matching `uses:` lines, not one per subpath.
3. `dependabot-automerge.yml` removed outright — see [Why no auto-merge](#why-no-auto-merge-anymore).

This is the general failure mode to watch for: **any action, npm package, or Cargo crate that this
repo references via more than one distinct `uses:`/import path from the same upstream repo** is a
grouping candidate, not just codeql-action. Re-run the audit in
[Detecting future grouping candidates](#detecting-future-grouping-candidates) whenever a new
workflow or dependency is added.

---

## Ecosystem inventory

| Ecosystem | `directory` | Groups configured | Notes |
|---|---|---|---|
| npm | `/` | `react` (react/react-dom/@types), `dev-tooling` (vitest/playwright/storybook/biome/stryker) | Root workspace; `open-pull-requests-limit: 10` |
| cargo | `/src-tauri` | `tauri-deps` (tauri*/wry/tao) | Tauri desktop backend; `open-pull-requests-limit: 5` |
| cargo | `/crates` | none yet | Wave 2 Rust Core workspace (`crates/worldscript-project`); currently only `serde`/`serde_json` — add a group if this workspace grows a same-repo-multi-path dependency |
| github-actions | `/` | `codeql-action` (`github/codeql-action*`) | See incident above |

All four entries share `cooldown: default-days: 7` (matches `.npmrc`'s
`minimum-release-age=10080` for npm; applied uniformly to cargo/github-actions too so a freshly-cut
release doesn't land in a PR before it's had a week to get pulled if broken).

---

## Why no auto-merge anymore

`dependabot-automerge.yml` (added 2026-07-28, removed 2026-08-20) auto-merged
`version-update:semver-patch` PRs once CI was green, to stop PRs stacking up during commit gaps. The
codeql-action incident showed the semver-patch signal alone isn't sufficient: a patch bump can still
be part of a larger multi-reference change that only makes sense atomically. Since there's no cheap
way to detect "this dependency has sibling references that must move with it" other than the
grouping config itself (which only covers what's already been identified), the safer default is
manual review for everything, with the grouping config as the primary defense against the specific
failure mode above.

If PR backlog becomes a problem again, prefer widening the `groups:` blocks (cheap, targeted) over
reinstating blanket auto-merge.

---

## Triage matrix — what's required before merging

| Semver level | npm | cargo | github-actions |
|---|---|---|---|
| **Patch** | CI green is sufficient | CI green is sufficient | CI green **and** confirm no sibling `uses:` path for the same repo was left behind (see incident) |
| **Minor** | CI green **and** a changelog skim for breaking changes despite semver (JS ecosystem doesn't always honor semver strictly) | CI green **and** changelog skim | CI green **and** changelog skim; same sibling-reference check as patch |
| **Major** | Full manual review — changelog, migration guide, likely held for a dedicated PR with its own test plan | Same | Same |

"CI green" always means the **full** suite for that PR (Quality Gate ×2, Build, E2E, E2E Deep
Coverage, Storybook, Lighthouse where applicable) — not just the required-check subset. See
[`CLAUDE.md`](../CLAUDE.md)'s branching-discipline section for the general "wait for advisory jobs
too" rule; it applies to dependency PRs exactly as it does to feature PRs.

## OSV ignore-expiry review

The 2026-08-20 consolidation review found **19** entries in `src-tauri/osv-scanner.toml`, all
currently sharing the `2026-11-30T00:00:00Z` review deadline. This is a synchronized review cliff,
not evidence that the risks were extended or resolved. The entries remain grouped by their real
reason: legacy GTK3/WebKit bindings, build-time `proc-macro-error`/`paste`, archived Unicode data
crates, and the transitive `extract-zip` advisory.

No ignore deadline was extended in this pass. `extract-zip` remains a transitive Playwright browser
download dependency with no patched release and no production-runtime footprint; it must still be
rechecked before expiry and removed as soon as an upstream fix or dependency-path change makes that
possible. Review each cluster against current upstream status before changing any deadline.

## Special-attention dependencies

These need more than a changelog skim because of documented quirks elsewhere in this repo:

| Dependency | Why it needs extra care |
|---|---|
| `vite` | Production build uses **rolldown**, not esbuild/rollup (see `CLAUDE.md` § Build & bundler gotchas). Rolldown ignores `rollupOptions.treeshake` and ties tree-shaking to `package.json "sideEffects"` — a Vite bump that changes how a dependency's `sideEffects` field is honored can produce a blank-screen prod build that CI's `vite dev`-based E2E suite won't catch. Run `pnpm run build && pnpm run smoke:prod` after any Vite bump, not just CI green. |
| `zod` | Has a repo-local patch (`patches/zod@4.4.3.patch`, forces `"sideEffects": true`) applied via `pnpm patch`. A version bump may need the patch re-applied/re-verified against the new version. |
| `react` / `react-dom` | Already grouped — must stay in lockstep, split bumps cause version-mismatch errors at test time. |
| `tauri*` / `wry` / `tao` | Already grouped (`tauri-deps`) — same lockstep concern for the desktop backend. |
| `github/codeql-action*` | Already grouped — see incident above. |
| `@biomejs/biome` | Check the installed package version against `biome.json`'s `$schema` URL after every bump; the schema URL is versioned independently from the npm dependency declaration. |
| Any WASM/WebGPU-adjacent package (`@huggingface/transformers`, `@mlc-ai/web-llm`, `onnxruntime-web`) | These ship in `vendor-*` SW-excluded chunks (`vite.config.ts` `globIgnores`) — verify a version bump didn't change the package's exported chunk structure in a way that breaks the manual-chunk mapping. |

## Merge discipline — one at a time, sequenced

Per standing policy for this session: **do not stack merges**. For each Dependabot PR, in order:

1. Confirm the PR's own CI is fully green (see triage matrix above for what "ready" means at that
   semver level).
2. Merge (squash).
3. Wait for the resulting **push-triggered** CI run on `main` (not just the PR's own run — a squash
   merge produces a new commit SHA that reruns the full pipeline) to reach a concluded, successful
   state.
4. Only then move to the next PR.

This is slower than merging a batch back-to-back, but avoids diagnosing a `main` failure against a
pile of unrelated changes, and avoids the specific "PR A's CI was green against a `main` that PR B's
merge just changed underneath it" class of race.

## Detecting future grouping candidates

Run this whenever a new workflow file is added, or periodically as a health check — it surfaces any
action referenced via more than one subpath of the same repo (the exact shape of the codeql-action
incident):

```bash
grep -rhoE "uses: [a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+(/[a-zA-Z0-9._/-]+)?@[a-f0-9]+" \
  .github/workflows/*.yml \
  | sed 's/uses: //' \
  | sed -E 's#(/[^/]+)$##' \
  | sort | uniq -c | sort -rn
```

A count > 1 for the same `org/repo` line is not automatically a problem (e.g. `Swatinem/rust-cache`
is used twice across `src-tauri` and `crates` jobs, each independently pinned — that's fine, they
don't need to match each other's version). It only matters when the multiple `uses:` lines are
**subpaths of the same action that must agree on version at runtime**, as codeql-action's
`init`/`analyze` do. Judgment call per hit, not a mechanical rule.

## Escalation

If a Dependabot PR's CI fails for a reason unrelated to the bump itself (flaky test, infra), retry
via re-running the failed job before assuming the dependency is at fault. If it's a genuine break
caused by the new version, do not force-merge — either pin to the last-known-good version explicitly
(`pnpm.overrides` / `[patch]` per ecosystem, documented in `AUDIT.md`) or leave the PR open with a
comment explaining the blocker until upstream fixes it.
