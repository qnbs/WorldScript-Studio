# WorldScript Studio — Current Agent Handoff

## 1. Capture Metadata

- Captured UTC: `2026-08-12T00:50:00Z`.
- Mode: live working state — this session pushed commits up to the moment of
  capture; a CI/review poll for the final SHAs below was still in flight when
  this document was written (see § 15 for how to check its result).
- Evidence labels: **LIVE FACT** = command/API evidence at capture; **HISTORICAL
  FACT** = retained provenance; **UNVERIFIED** = no closure claim.
- This handoff supersedes its own earlier revision from `2026-08-11T23:46:00Z`
  in the same session (that revision is not separately archived — this file
  simply advanced twice in one session as more work landed). It also
  supersedes the `2026-08-11T11:14:45Z` capture, archived at
  `docs/session-handoff/archive/CLAUDE-HANDOFF-20260811T111445Z.md`.

## 2. Executive Summary

The active stack is #335 (foundation) → #336 (desktop/AI) → #337 (recovery);
`main` is `804793aa0815a726935785639e4fb139af7c4b59` (unchanged all session).

**Current heads:** #335 `0353364d`, #336 `c3f00cff`, #337 `0b1cc2ed`.

Review-thread quiescence as of this capture: #335 has exactly **one**
deliberately-left-open thread (a supply-chain hardening suggestion needing a
`pnpm install` this host cannot safely run — § 8); #336 and #337 both show
**0 unresolved**. A background poll for a possible fresh review wave on the
just-pushed #336/#337 SHAs was still running when this document was written —
**check § 15 before trusting "0 unresolved" as final.**

This session found and fixed **sixteen** genuine, non-cosmetic defects across
the stack — not review-comment busywork. Three were on #335 (two could strand
a user with configured at-rest encryption unable to unlock at all, one broke
an accessibility E2E test via a silently regressed theme default); the
remaining thirteen were spread across two review waves on #336 (race
conditions, protocol-routing bugs, a Rust cache-staleness bug, and a
save-time validation gap) — see § 6 for the complete list with evidence.

Legacy PR #310 remains open and must neither be merged nor closed as
superseded yet — its ledger reconciliation advanced (PR310-R009's disposition
fixed) but is far from complete. #332/#333 remain open with no packaged
`.deb` evidence — explicitly deferred again this session; this host cannot
safely produce that evidence.

**Standing merge authorization**: the user has authorized merging the
#335→#336→#337 stack into `main` once every PR reaches review-thread
quiescence and CI is green, without asking again, provided none of the NO-GO
conditions in § 19 are triggered. As of this capture, that bar is **close but
not confirmed** — #335's CI was fully green on `0353364d` as of the last
check (§ 15 has the evidence), but #336 and #337 have NOT yet had their CI
re-verified on their newest SHAs (`c3f00cff` / `0b1cc2ed`), and the
fresh-review-wave poll for those two SHAs had not concluded at capture time.
**Do not merge until you've confirmed all three are green and the poll found
no new unresolved threads (§ 15).**

## 3. Exact Live Git State

| Field | Value | Evidence |
| --- | --- | --- |
| Branch | `feat/encryption-recovery-journal` | LIVE FACT |
| Head | `0b1cc2ed` (docs commit for this handoff will land on top) | LIVE FACT |
| Upstream | `origin/feat/encryption-recovery-journal`, head == upstream as of `0b1cc2ed` | LIVE FACT |
| Tree | Clean before this handoff commit; no stash entries | LIVE FACT |
| Origin | `https://github.com/qnbs/WorldScript-Studio.git` | LIVE FACT |
| Default branch | `main @ 804793aa0815a726935785639e4fb139af7c4b59` | LIVE FACT |

Local branches `fix/encryption-lifecycle-safety` (#335, head `0353364d`) and
`fix/desktop-reliability-hardening` (#336, head `c3f00cff`) both exist and
match their respective `origin/*` remotes exactly — no unpushed local work on
any of the three stack branches as of capture.

## 4. Live PR Stack / Branch Topology

| PR | Responsibility | Head → base | Review threads (unresolved/total) | Notes |
| --- | --- | --- | --- | --- |
| #335 | encryption/settings/pnpm foundation | `0353364d` → `main@804793aa` | 1/41 (the deliberately-open uuid thread) | CI confirmed fully green on this SHA (§ 15) |
| #336 | Local AI/provider/Python/LoRA desktop reliability | `c3f00cff` → `#335@0353364d` | 0/56 as of last check | CI/fresh-wave check on this SHA in flight (§ 15) |
| #337 | recovery journal, adapters, #310 replacement | `0b1cc2ed` → `#336@c3f00cff` | 0/57 as of last check | CI/fresh-wave check on this SHA in flight (§ 15) |
| #310 | legacy secondary-store encryption | `27177ce5` → `main@804793aa` | 28/317 (not touched this session) | Stays open — do not merge/close |

Other open Dependabot PRs (#312–334) and #311 are outside this remediation
stack — no action needed there.

## 5. Commits This Session (newest first per branch; only this session's work)

**#337 (`feat/encryption-recovery-journal`):**

| SHA | Message |
| --- | --- |
| (this handoff commit) | `docs: refresh session handoff (second pass)` |
| `0b1cc2ed` | merge `fix/desktop-reliability-hardening` — brings #336's 7-fix wave in |
| `74ce8fd3` | `docs: refresh stack SHAs after the appearancePreset/unlock-routing fix cascade` |
| `dd92628f` | merge `fix/desktop-reliability-hardening` — brings #336's 3-fix wave + #335's cascade in |
| `58d95d1e` | `docs: refresh session handoff, archive the prior capture` |
| `ed46befd` | `docs: refresh stack SHAs in the performance ledger; reconcile PR310-R009 to a valid disposition` |
| `68050d80` | `docs(test): clarify encryptionMigrationJournal.test.ts's ownership-CAS comment` |
| `3f31c1e1` | `fix(ollama): report invalidResponse instead of a false-positive connection success` |
| `beadfa22` | `fix(ai): degrade cache reads to a miss on lock/migration, re-encrypt legacy entries on read` |
| `411943a8` | `fix(storage): fail migration to recovery-required on a verification shortfall` |
| `46198b26` | `fix(storage): skip corrupt scene revisions instead of hiding history; narrow write guard to migration-only` |
| `dc0b5262` | `fix(settings): stop rendering the connection test result twice in AiProviderCard` |

**#336 (`fix/desktop-reliability-hardening`):**

| SHA | Message |
| --- | --- |
| `c3f00cff` | `fix(settings): auto-validate a newly saved Gemini key instead of deferring to the next generation call` |
| `ebafce7a` | `fix(desktop): revalidate the cached Python interpreter before trusting it` |
| `d536649d` | `fix(settings,ai): decouple URL edits from protocol preset; guard preload progress against superseded attempts` |
| `be11482c` | `fix(lora,settings): stale-run training race, stuck onboarding on cancel, stale model list on context switch` |
| `ad4364ac` | merge `fix/encryption-lifecycle-safety` — brings #335's cascade in |

**#335 (`fix/encryption-lifecycle-safety`):**

| SHA | Message |
| --- | --- |
| `0353364d` | `fix(settings): restore sepia as the first-run appearance default` |
| `99c28392` | `fix(storage): route locked encrypted startup and Lock Session to the unlock modal, not a dead end` (cherry-picked from a mis-layered original commit `667f6f37`, see § 16) |

Earlier in this session (before the portion of work summarized above), #335
and #336 each independently reached review-thread quiescence with CodeAnt
gates green — those commits are not re-listed here; `git log` on each branch
has the full history if needed.

## 6. Real Defects Found and Fixed This Session (complete list, not review busywork)

### #335 (foundation layer)

1. **Cold-start encrypted-storage lockout with no way to unlock (`99c28392`).**
   `loadState()` throwing `IdbStorageLockedError` (sentinel exists, no key
   active yet) previously fell into `index.tsx`'s generic catch-all →
   `StorageErrorScreen`, whose only action is "Reset Database & Reload"
   (**destroys all local data**). `App.tsx`'s own unlock-detection effect
   never got a chance to run since `<App>` never mounted. Fixed: the
   bootstrap IIFE is now a named, re-invocable `bootApp()`; a locked-storage
   catch renders a standalone `IdbUnlockModal` (confirmed Redux-free — only
   needs `I18nProvider`) and retries the full boot in place on success (no
   page reload, which would lose the freshly-unlocked in-memory key).
2. **"Lock Session" silent-data-loss trap (`99c28392`, same commit).**
   `handleLockSession()` cleared the key but never opened the unlock modal
   and didn't block editing — every subsequent autosave silently failed
   closed with only a generic toast, no route back to unlocking short of
   manually reopening Settings. Fixed: also opens the global unlock modal
   (`transientUiStore.setIdbUnlockOpen(true)`).
3. **First-run appearance default silently regressed `sepia` → `default`
   (`0353364d`).** `main` deliberately keeps the first-run default (`sepia`)
   different from the legacy-rehydration fallback (`default`, so an existing
   user's pre-field data isn't retroactively theme-shifted) — this branch had
   drifted to using `'default'` for both, with an incorrect comment claiming
   they "must agree." Directly caused `tests/e2e/a11y.spec.ts`'s dark-sepia
   accessibility test to fail (confirmed via the CI log). Reverted to match
   main's design; CI's E2E job then went green on the very next run (§ 15).

### #336, first review wave (`be11482c`, `d536649d`, `ebafce7a`, `c3f00cff`)

4. **`loraThunks.ts` — stale-run training-outcome race.** `startTrainingThunk`'s
   catch classified a killed process's rejection using the CURRENT Redux
   `currentRun.cancellationRequested`, not the run that produced it.
   `abort_lora_training` awaits child-process exit before resolving, so a new
   training run can start before the killed run's own `train_lora` promise
   finally rejects — the catch could then wrongly archive the NEWER run as
   failed/aborted using the OLDER run's outcome. Fixed: guards on
   `currentRun.id` matching the invocation's own `runId`.
5. **`LoraOnboarding.tsx` — stuck on "checking" forever.** Cancelling the
   native Python file picker resolves `null`, but the request-generation
   guard was bumped unconditionally before checking the result — invalidating
   the still-pending initial environment check without ever applying a
   replacement, since `setEnv` only ran on a truthy result. Fixed: the guard
   now only advances once there's an actual new result to apply.
6. **`AiProviderCard.tsx` — stale model list survives a context switch.**
   `useConnectionContextReset` invalidated in-flight tests/loads on a
   provider/endpoint/preset change but never cleared the already-rendered
   `ollamaModels` list, so a user could select a model id that doesn't exist
   on the newly selected server. Fixed: `setOllamaModels([])` added to the
   reset effect.
7. **`AiProviderCard.tsx` — URL edits silently reassigned the protocol.**
   Editing the "Ollama Server URL" field unconditionally set
   `localBackendPreset: 'custom'`, which `isOpenAiCompatibleLocalPreset`
   always routes through the OpenAI-compatible protocol — a native-Ollama
   user just changing host/port had their protocol silently switched and
   every completion started failing. Fixed: the URL input now only updates
   `ollamaBaseUrl`; protocol selection stays explicit via the preset dropdown.
8. **`localAiFacade.ts` — superseded preload overwrites newer modal state.**
   `preloadLocalModel`'s own progress-report calls, and the ones inside
   `generateLocalText` gated by `reportToGlobalProgress`, ran unconditionally.
   `retryLastPreload()` starting a new attempt while an older, cancelled
   attempt's `generateLocalText` call was still settling could let that stale
   attempt overwrite the newer attempt's modal state. Fixed: extended the
   existing `activePreloadAbort` identity-guard pattern to every progress-
   report call site via a new `isCurrentAttempt` option.
9. **`src-tauri/src/lora.rs` — cached Python interpreter trusted forever.**
   `resolve_python()` never re-validated a cached entry — if the interpreter
   was removed/replaced/lost its executable bit while the app stayed open,
   environment checks kept reporting Python as available and training only
   failed later at spawn. Fixed: `cached_python_still_valid()` reuses
   `probe_python`'s lightweight filesystem-only check before trusting a cache
   hit. **Not verified via a full `cargo check`/build** — no cached `target/`
   artifacts on this host, would be a from-scratch compile; verified via
   `cargo fmt --check` (zero diff, confirms valid syntax) plus careful manual
   review. CI's Tauri build job is the real type-check gate — confirm it's
   green on `c3f00cff` before trusting this compiles (§ 15/§ 18).
10. **`ApiKeySection.tsx` — saved Gemini key never actually validated.**
    `handleSaveKey` only ran syntactic checks (length + control chars) before
    marking the key active — a misleading comment claimed provider validation
    happened at save time when it didn't; a malformed/wrong key "saved
    successfully" until a later generation call happened to fail. Fixed:
    saving now auto-triggers the same test-connection flow the explicit Test
    Connection button uses (which already flips `hasKey` back to `false` on
    an invalid-key response).

Each of items 4–10 has a citation-linked reply + resolved thread on PR #336
(GraphQL `resolveReviewThread`) and a regression test — see the commit
messages for exact test names, or `git show <sha> --stat` for the file list.

### #337-specific fixes (from before this session's #335/#336 discovery work)

11. TOCTOU guard reordering self-correction (`46198b26` following an earlier
    `a8dd9175`) — narrowed the migration-write guard to
    `assertNoActiveEncryptionMigration()` only, since `resolveProtectedWriteKey()`
    already performs its own lock check atomically; the broader guard wrongly
    rejected an already-safely-encrypted write if the session locked
    mid-write (caught by an existing regression test).
12. `listRevisions()` no longer lets one damaged revision hide a whole
    scene's history (`46198b26`) — skips and logs a `SecureRecordCorruptError`
    per-record instead of rejecting the whole call.
13. Migration verification shortfall now moves the journal to
    `recovery-required` instead of retrying forever with no operator
    visibility (`411943a8`) — new `ProtectedStoreVerificationShortfallError`.
14. `aiInferenceCacheService.ts` read path now degrades to a miss on a
    lock/migration failure instead of rejecting (`beadfa22`), matching its
    own non-authoritative contract; legacy plaintext cache entries are now
    opportunistically re-encrypted on read via the same `needsMigration`
    signal the journal adapters use.
15. `testOllamaConnection()` now reports `invalidResponse` instead of a
    false-positive `ok:true` on a malformed body (`3f31c1e1`).
16. `AiProviderCard.tsx` no longer renders the connection test result twice
    (`dc0b5262`) — the status panel is now the single rendering location.

## 7. What's Genuinely Still Open (do not claim these are done)

1. **The one #335 review thread left unresolved on purpose** (§ 8) — needs a
   `pnpm install` from a properly-resourced environment.
2. **#336 and #337's newest SHAs (`c3f00cff`, `0b1cc2ed`) have not had their
   CI or a possible fresh review wave confirmed yet** — a background poll was
   running at capture time. Check § 15 first.
3. **#310 reconciliation is not complete.** PR310-R009's disposition was
   corrected this session (§ 9), but most of its 317 historical threads (28
   currently unresolved) were not touched.
4. **#332/#333 packaged desktop evidence** — explicitly deferred again. No
   `.deb` build/install/relaunch matrix ran this session either.
5. **`index.tsx`'s locked-storage bootstrap branch has no automated test** —
   the file has zero pre-existing test infrastructure. Verified by static
   dependency tracing only. Worth revisiting if there's time budget later.
6. **`src-tauri/src/lora.rs`'s async caching fix (`cached_python_still_valid`)
   has not been compiled locally** — only `cargo fmt --check` ran. Confirm
   CI's Tauri build job is green on `c3f00cff` (or whatever SHA carries it
   forward) before treating this as verified.

## 8. The One Deliberately-Open #335 Thread

CodeRabbit flagged `pnpm-workspace.yaml`'s `uuid: ">=11.1.1"` override as a
bare floor that would still permit two known-vulnerable exact releases
(`12.0.0`, `13.0.0` — GHSA-w5hq-g745-h8pq / CVE-2026-41907) if a future
resolution ever landed on them; the currently-locked `uuid@14.0.1` is
unaffected today. This is a real, correctly-identified hardening gap.

The precise fix was applied and verified correct, then reverted:
`uuid: ">=11.1.1 <12.0.0 || >=12.0.1 <13.0.0 || >=13.0.1"` in both
`pnpm-workspace.yaml` and the two matching fields in `pnpm-lock.yaml`
(`overrides.uuid` and the `uuid` importer's `specifier`). The moment the
override string changes, this repo's `verifyDepsBeforeRun: error` policy (by
design) refuses to run **any** script — including a plain typecheck — until a
real `pnpm install` reconciles `node_modules`' installed state with the new
override; this was confirmed empirically (`tsgo` failed with
`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` the moment the edit was made). This
session's host is memory-severely-constrained and a full `pnpm install` for a
project this size (transformers.js/onnxruntime/webllm/Playwright/Storybook
among the devDependencies) risks an OOM crash mid-install, leaving the
lockfile in a worse, half-resolved state than today's.

**To close this thread:** from a normal-resourced environment (or a
dependency-update CI job), apply the exact override string above to both
files consistently, run `pnpm install` to let it reconcile, verify
`pnpm run typecheck` and `pnpm run lint` pass, then push, reply to the thread
citing the resolving commit, and resolve it via GraphQL `resolveReviewThread`.
Thread id at capture time: `PRRT_kwDOQOeAgc6YK1Aq` on PR #335 (re-fetch if
the SHA has moved and IDs changed).

## 9. PR #310 Reconciliation

- Ledger: `docs/PR-310-RECONCILIATION.md`.
- Strategy: Option C — replace through #335 + #337 while preserving all
  material behavior and useful test intent. Unchanged this session.
- Live PR: #310 at `27177ce549d4579f1fc9dfbc4630ebf0c2592f9b`; still open, still
  `BLOCKED`. Do not merge or close.
- **This session's change:** PR310-R009 (was `REWRITE`, an impermissible
  interim disposition) and two related rows describing the same underlying
  "missing-store/interruption/legacy-shape/resume/verification coverage"
  concern are now `ADOPTED_WITH_MODIFICATIONS`, pointing to a new
  consolidated row `PR310-R016` with concrete test-name citations.
- **Not done:** the doc's 28 currently-unresolved historical review threads
  and the remainder of its 317-thread total were not fetched/classified this
  session.

## 10. #332 / #333 Status (unchanged this session — explicitly deferred again)

| Workstream | State | Evidence | Closure classification |
| --- | --- | --- | --- |
| #332 `.deb` sluggish Settings | Open | No package/profile | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| #332 sepia persistence | Open | **Root cause now understood and fixed on #335 this session** (§ 6 item 3) — but still no relaunch matrix / packaged proof | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` → verify with packaged evidence before closing |
| #333 Local-AI acquisition | Open | Code direction only; no terminal runtime proof | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| #333 UI freezes/overlap | Open | No trace/zoom/RTL/package matrix | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| #333 Gemini/LM Studio | Open | Code hardening this session too (§ 6 items 7, 10); packaged diagnostic unverified | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| #333 Python/LoRA | Open | Cache-staleness fix this session (§ 6 item 9); native build not re-verified | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` |

Neither issue is eligible for closure this session.

## 11. Performance / Responsiveness Status

- Ledger: `docs/ISSUES-332-333-PERFORMANCE-LEDGER.md` — SHAs refreshed
  multiple times this session; last refresh should be re-verified against
  § 4's current heads before relying on it (this document may have been
  written slightly before the very last SHA update — check `git log` on the
  ledger file if precision matters).
- No `.deb` build/install/terminal launch/menu launch/Wayland/X11 test
  occurred this session.

**PERFORMANCE CLOSURE NOT YET VERIFIED.** Browser/Vercel/unit success cannot
close the packaged Tauri reports.

## 12. pnpm / Supply-Chain Status

| Item | Value |
| --- | --- |
| Declared / active pnpm | `11.5.2` |
| `verifyDepsBeforeRun` | `error` — confirmed live-tested this session (blocks all scripts on an override-string change until `pnpm install`) |
| `uuid` override | `">=11.1.1"` (bare floor) — a tighter, verified-correct replacement string is specified in § 8 but not yet applied (needs a real install) |
| Everything else in `pnpm-workspace.yaml`'s `overrides` | Unchanged this session |

**Do not hand-edit `pnpm-workspace.yaml`/`pnpm-lock.yaml` override strings
without immediately following up with a real `pnpm install`** on a
properly-resourced machine — confirmed empirically this session that
`verifyDepsBeforeRun: error` blocks every subsequent script the instant the
override string and installed `node_modules` state diverge.

## 13. Review-Thread Reconciliation Method Used This Session

For every unresolved thread across #335/#336/#337: read the finding's full
body (GraphQL `reviewThreads` → `comments.nodes[].body`, paginated at 100),
then verify against the **current** code at the file/line referenced
(anchors drift — `isOutdated: true` is not a disposition by itself, the
underlying claim must be re-checked against live code). Classification used:

- **Already fixed** — a prior commit (this session or earlier) already
  addressed it; reply citing the exact resolving commit SHA plus the specific
  code/test evidence, then resolve.
- **False positive** — the finding's premise doesn't hold against current
  code; reply with evidence, then resolve.
- **Real, fixed this session** — implement the root-cause fix + test, reply
  citing the new commit, resolve.
- **Real, deliberately deferred** — confirmed valid, but the safe fix
  requires something this environment cannot do (§ 8's `pnpm install` case);
  reply with the exact fix specification and the reason it's blocked, and
  **leave it unresolved** rather than falsely closing it.

Never resolve a thread solely because its anchor moved — that's a stale
pointer, not evidence the concern was addressed. Twice this session, pushing
a fix to one PR and cascading it forward triggered a **fresh review wave**
that surfaced genuinely new findings on pre-existing code the push touched
indirectly (merge diffs can re-expose files to a fuller review pass) — after
any push to this stack, always re-check thread counts before assuming
quiescence holds (§ 15's queries are the fast way to do this).

## 14. Local Resource Constraints

| Metric | Capture value (this session, near end) |
| --- | --- |
| RAM | 3.7 GiB total; ~1.3 GiB free/available (fluctuated between ~109 MiB and ~1.6 GiB free over the session) |
| Swap | 3.9 GiB total; ~2.0 GiB used |
| CPUs/load | 2; load average consistently 3.5–5.5 |
| Disk | ~6.2 GiB free; 94% used |
| Class | `SEVERELY_CONSTRAINED` throughout |

One Bash command per turn; heavy commands (`vitest run` across many files,
`biome check` on the full repo) reliably exceed the 120s foreground timeout
and move to background automatically — expected, not a failure; poll via the
background task's output file. No local `pnpm install`, `cargo check`, or
`cargo build` — confirmed this session that both are genuinely unsafe here
(the pnpm one empirically, the cargo one by absence of any cached `target/`
to make it incremental).

## 15. How to Check Whether This Session's Final Pushes Landed Green

A background poll for a fresh review wave on #336 (`c3f00cff`) and #337
(`0b1cc2ed`) was still running when this document was written. To pick up:

```bash
gh pr checks 335   # confirmed fully green on 0353364d as of this capture
gh pr checks 336   # NOT yet re-verified on c3f00cff — check this first
gh pr checks 337   # NOT yet re-verified on 0b1cc2ed — check this first
```

```bash
# Unresolved thread count per PR (expect 1 / 0 / 0 if the poll found nothing new):
gh api graphql -f query='query { repository(owner: "qnbs", name: "WorldScript-Studio") { pullRequest(number: 336) { reviewThreads(first: 100) { totalCount nodes { isResolved } } } } }' --jq '{total: .data.repository.pullRequest.reviewThreads.totalCount, unresolved: [.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length}'
```
(repeat for 335 and 337 — 335's total was 41 with 1 unresolved as of capture)

If a NEW thread count appears (total higher than 41/56/57 for 335/336/337),
that's the fresh-wave phenomenon described in § 13 — fetch, classify, and fix
each one the same way, then re-push and re-check until two consecutive checks
show no new findings and 0 unresolved (except § 8's deliberately-open one).

If all three show green CI and the expected thread counts, the standing
merge authorization (§ 2) is satisfied for the review/quality dimension.
Still re-check § 19's NO-GO conditions (native Rust evidence for #336's Tauri
build — especially important now given item 9/§ 6's unverified Rust change,
#310 state, #332/#333 evidence) before actually merging.

## 16. A Layering Mistake Made and Corrected This Session

Two of #335's fixes (§ 6 items 1–2) were initially committed directly onto
`feat/encryption-recovery-journal` (#337) as commit `667f6f37` — a violation
of "fix at the earliest affected layer," since it would have left #335 and
#336 still broken while #337 alone had the fix. Caught before pushing
further and corrected: `667f6f37`'s content was cherry-picked onto #335
(`99c28392`), pushed, then cascaded forward through #336 (`ad4364ac`) and
back into #337 via normal merges. `667f6f37` remains in #337's own commit
history (harmless — identical file content, folded into the merge ancestry
afterward) but is superseded as the "source of truth" location by the
cherry-pick on #335. If diffing history and this commit appears twice with
different SHAs, that's why.

## 17. Uncommitted / Unpushed State

Tree was clean and all three branches pushed and matching their `origin/*`
remotes exactly, immediately before this handoff document's own commit. No
stash, reset, clean, rebase, or force push occurred this session.

## 18. Exact Next Actions

1. **Check § 15 first** — confirm #336/#337's CI on their newest SHAs and
   whether the fresh-wave poll found anything new.
2. **If a new wave appeared:** fetch, classify (§ 13), fix, reply+resolve,
   push, and re-poll — do not stop after one pass; this session hit this
   exact pattern twice already.
3. **Once truly quiescent + green:** the standing merge authorization
   applies. Re-verify § 19's NO-GO conditions (especially the unverified Rust
   compile — confirm CI's Tauri build job, not just `cargo fmt`, is green on
   whatever SHA carries `ebafce7a`'s change forward), then merge #335 → `main`,
   then #336 (auto-retargets), then #337 (same), in that order.
4. **After merging (or if not merging this session):** continue #310
   reconciliation (§ 9) — 28 of 317 threads and the bulk of the ledger's
   remaining rows are untouched.
5. **When a properly-resourced environment is available:** close § 8's
   deliberately-open #335 thread.
6. **When packaged-desktop validation is possible again:** #332/#333 (§ 10) —
   the sepia-persistence and Python-cache-staleness root causes are now fixed
   in-stack and mainly need relaunch-matrix proof; the rest need fresh `.deb`
   evidence entirely.

## 19. Merge / Release NO-GO Conditions (unchanged, all still active)

No merge/release while: a silent plaintext downgrade is possible; the
migration/session race is unresolved (§ 6 items 11/13 narrowed but did not
eliminate the theoretical migration-vs-write race — documented as an
accepted, bounded residual risk, not a NO-GO by itself since it now fails
safe-and-visible); #310 material items remain unreconciled (they do — § 9);
#332/#333 lack packaged desktop evidence (they do — § 10); native Rust/Tauri
build evidence isn't tied to a final SHA (**newly relevant this session** —
§ 6 item 9's Rust change was never compiled locally; confirm CI's Tauri build
job specifically, not just the lighter checks, before treating #336/#337 as
safe to merge); or any review thread was resolved merely because its anchor
moved (this session was careful about this — § 13 — but spot-check if you
want independent confirmation).

## 20. Files / Symbols To Read First

1. `docs/session-handoff/CURRENT-HANDOFF.md` (this file)
2. `docs/PR-310-RECONCILIATION.md`
3. `docs/ISSUES-332-333-PERFORMANCE-LEDGER.md`
4. `index.tsx` (`bootApp`), `hooks/useSettingsView.ts` (`handleLockSession`),
   `features/settings/settingsSlice.ts` (`appearancePreset`) — #335's three
   real-bug fixes
5. `features/lora/loraThunks.ts`, `components/lora/LoraOnboarding.tsx`,
   `components/settings/AiProviderCard.tsx`, `services/localAiFacade.ts`,
   `src-tauri/src/lora.rs`, `components/ApiKeySection.tsx` — #336's seven
   fixes from the fresh review wave
6. `services/storage/protectedStoreMigration.ts`,
   `services/storage/storageEncryptionService.ts`,
   `services/ai/aiInferenceCacheService.ts`, `services/ollamaService.ts` —
   #337's earlier fixes this session
7. `pnpm-workspace.yaml`, `pnpm-lock.yaml` — read § 8/§ 12 before touching

## 21. Safe First Commands For Next Agent

```bash
git status --short
git branch --show-current
git log -n 15 --oneline --decorate
free -h
gh pr checks 335
gh pr checks 336
gh pr checks 337
```

Then run the review-thread count queries in § 15, and read the CI logs for
any red job before reproducing anything locally.

## 22. Commands To Avoid

- `pnpm install` without a properly-resourced environment, or without
  immediately reconciling every file touched (§ 8, § 12).
- `cargo check` / `cargo build` on this host — no cached `target/`, would be
  a from-scratch compile of the whole Tauri dependency tree (§ 6 item 9, § 14).
- Hand-editing `pnpm-workspace.yaml`/`pnpm-lock.yaml` override strings
  without a follow-up install.
- Any full local coverage/E2E/mutation/Lighthouse/Storybook/Tauri build —
  cloud CI only on this hardware.
- Resolving a review thread because its anchor moved, without re-verifying
  the underlying concern against current code.
- `--admin` merges to route around a `mergeable_state` cache lag — re-poll
  instead (see the project `CLAUDE.md`'s documented quirk).

## 23. Open Questions / Uncertainty

1. Did the fresh-review-wave poll for #336 (`c3f00cff`) / #337 (`0b1cc2ed`)
   find anything new? Unresolved at capture time — check § 15.
2. Does `src-tauri/src/lora.rs`'s `cached_python_still_valid` change actually
   compile? Only `cargo fmt --check` ran locally (zero diff, syntax looks
   valid) — CI's Tauri build job is the real gate and hasn't been confirmed
   on a SHA carrying this change yet.
3. Is #336's native Tauri build evidence (from an earlier session, before
   this one's Rust change) still meaningful now that the Rust source changed?
   Almost certainly needs a fresh dispatch.
4. Does #310's remaining 28 unresolved threads (of 317) contain anything that
   changes the Option C strategy, or are they all already superseded by
   #335/#337 work? Not investigated this session.
5. Is there a *second* place in the codebase assuming `appearancePreset`'s
   first-run default is `'default'` rather than `'sepia'`? A targeted grep
   found none among test files, but wasn't exhaustive against every UI
   consumer.
6. Should `index.tsx`'s `bootApp` be exported and given a real test harness?
   Deferred again this session.

## 24. Handoff Integrity Checklist

- [x] Local state captured before writing this document; no state discarded.
- [x] Live PR stack, #310, #332/#333 state queried and reflected.
- [x] SHA-bound evidence captured for every claim above.
- [x] Performance non-closure and #310 non-final state kept explicit.
- [x] The one genuinely-deferred item (§ 8) documented with its exact fix and
      why it's blocked, not silently dropped.
- [x] The layering mistake (§ 16) documented rather than hidden.
- [x] The unverified Rust compile (§ 6 item 9, § 19) flagged as a real gap,
      not glossed over.
- [ ] Final confirmation that #336/#337 CI is green and no fresh review wave
      landed on their newest SHAs — pending at capture time (§ 15).
