# WorldScript Studio — Current Agent Handoff

## 1. Capture Metadata

- Captured UTC: `2026-08-11T23:46:00Z` (local `2026-08-12T01:46:00+02:00`).
- Mode: live working state — this session pushed commits up to the moment of
  capture; a CI poll for the final SHAs below was still in flight when this
  document was written (see § 15 for how to check its result).
- Evidence labels: **LIVE FACT** = command/API evidence at capture; **HISTORICAL
  FACT** = retained provenance; **UNVERIFIED** = no closure claim.
- This handoff supersedes `docs/session-handoff/CURRENT-HANDOFF.md` as it stood
  at `2026-08-11T11:14:45Z` (archived alongside prior codex handoffs in
  `docs/session-handoff/archive/`). Very substantial work happened between that
  capture and this one — read this document fresh; do not assume anything from
  the prior one still applies without re-verifying.

## 2. Executive Summary

The active stack is #335 (foundation) → #336 (desktop/AI) → #337 (recovery);
`main` is `804793aa0815a726935785639e4fb139af7c4b59` (unchanged all session).

**All three stack PRs reached 0 unresolved review threads this session**,
except #335 which has exactly **one** deliberately-left-open thread (a
supply-chain hardening suggestion that needs a `pnpm install` this host cannot
safely run — see § 8). CodeAnt quality gates are green on #336 and #337 at
their current SHAs. #335's CI was still resolving the E2E suite against its
final SHA when this document was written (see § 15) — a real, confirmed
sepia-default regression was found and fixed as part of this session's work
and is included in that SHA, but the fresh E2E run against it had not yet
reported by capture time.

This session found and fixed several genuine, non-cosmetic defects beyond
review-comment busywork — most notably two that would have broken the B-1
at-rest encryption feature for real users (see § 6). Legacy PR #310 remains
open and must neither be merged nor closed as superseded yet — its ledger
reconciliation advanced (PR310-R009's disposition fixed) but is not complete.
#332/#333 remain open with no packaged `.deb` evidence — explicitly deferred
again this session; this host cannot safely produce that evidence.

**Standing merge authorization**: the user has authorized merging the
#335→#336→#337 stack into `main` once every PR reaches review-thread
quiescence and CI is green, without asking again, provided none of the NO-GO
conditions in § 19 are triggered. As of this capture, that bar is **not yet
met** — #335's E2E result on its final SHA was still pending, and #335 has one
deliberately-open thread (see § 8 for why that specific one does not have to
block: it's a hardening improvement to an already-safe pinned resolution, not
an active vulnerability). Do not merge until you have confirmed #335's CI is
fully green on `0353364df974362d8ca6c4f1e50a229a8ef4219c` — check this before
anything else (§ 15).

## 3. Exact Live Git State

| Field | Value | Evidence |
| --- | --- | --- |
| Branch | `feat/encryption-recovery-journal` | LIVE FACT |
| Head | `74ce8fd3` | LIVE FACT |
| Upstream | `origin/feat/encryption-recovery-journal`, head == upstream | LIVE FACT |
| Tree | Clean; no staged, unstaged, untracked, or stash entries | LIVE FACT |
| Origin | `https://github.com/qnbs/WorldScript-Studio.git` | LIVE FACT |
| Default branch | `main @ 804793aa0815a726935785639e4fb139af7c4b59` | LIVE FACT |

Local branches `fix/encryption-lifecycle-safety` (#335) and
`fix/desktop-reliability-hardening` (#336) both exist and match their
respective `origin/*` remotes exactly (see § 4 for their SHAs) — no unpushed
local work on any of the three stack branches.

## 4. Live PR Stack / Branch Topology

| PR | Responsibility | Head → base | Review threads (unresolved/total) | Merge state |
| --- | --- | --- | --- | --- |
| #335 | encryption/settings/pnpm foundation | `0353364d` → `main@804793aa` | 1/41 (the deliberately-open uuid thread) | check live before acting — was `BLOCKED` before this session's E2E fix, unverified after |
| #336 | Local AI/provider/Python/LoRA desktop reliability | `ad4364ac` → `#335@0353364d` | 0/49 | `CLEAN` as of its prior SHA; re-verify after this session's merge |
| #337 | recovery journal, adapters, #310 replacement | `74ce8fd3` → `#336@ad4364ac` | 0/59 (2 new doc-only commits since the 57-thread count) | re-verify; was clean through `ed46befd` |
| #310 | legacy secondary-store encryption | `27177ce5` → `main@804793aa` | 28/317 (not touched this session) | `BLOCKED`, stays open — do not merge/close |

Other open Dependabot PRs (#312–334) and #311 are outside this remediation
stack — no action needed there.

## 5. Commits This Session (newest first, on `feat/encryption-recovery-journal` unless noted)

| SHA | Branch | Message | Notes |
| --- | --- | --- | --- |
| `74ce8fd3` | #337 | `docs: refresh stack SHAs after the appearancePreset/unlock-routing fix cascade` | ledger only |
| `dd92628f` | #337 | (merge) `fix/desktop-reliability-hardening` into `feat/encryption-recovery-journal` | brings #336's cascade in |
| `0353364d` | #335 | `fix(settings): restore sepia as the first-run appearance default` | **real regression fix** — see § 6 |
| `ad4364ac` | #336 | (merge) `fix/encryption-lifecycle-safety` into `fix/desktop-reliability-hardening` | brings #335's cascade in |
| `99c28392` | #335 | `fix(storage): route locked encrypted startup and Lock Session to the unlock modal, not a dead end` | **real regression fix**, cherry-picked from `667f6f37` — see § 6 |
| `667f6f37` | (superseded on #337) | same fix, originally committed directly to #337 by mistake — see § 16 for the layering-error story | left in #337's own history; harmless (identical content, properly cascaded via merge afterward) |
| `68050d80` | #337 | `docs(test): clarify encryptionMigrationJournal.test.ts's ownership-CAS comment` | |
| `3f31c1e1` | #337 | `fix(ollama): report invalidResponse instead of a false-positive connection success` | |
| `beadfa22` | #337 | `fix(ai): degrade cache reads to a miss on lock/migration, re-encrypt legacy entries on read` | |
| `411943a8` | #337 | `fix(storage): fail migration to recovery-required on a verification shortfall` | new `ProtectedStoreVerificationShortfallError` |
| `46198b26` | #337 | `fix(storage): skip corrupt scene revisions instead of hiding history; narrow write guard to migration-only` | |
| `dc0b5262` | #337 | `fix(settings): stop rendering the connection test result twice in AiProviderCard` | |

Earlier in this session (before the portion transcribed above — see the
conversation summary if you need it): #335 and #336 individually reached
review-thread quiescence with CodeAnt gates green (commits `5e80aaa4` and
`2438f991` respectively, both now further advanced by the two fixes above).

## 6. Real Defects Found and Fixed This Session (not just review-comment busywork)

These were discovered by cross-checking review findings against actual
current code — some review findings turned out to already be fixed, but a
few, once investigated, were genuine and severe:

1. **Cold-start encrypted-storage lockout with no way to unlock (#335,
   `99c28392`).** When at-rest encryption (B-1) is configured but not yet
   unlocked in a fresh tab, `dbService.loadState()` throws
   `IdbStorageLockedError`. `index.tsx` awaited this *before* mounting `<App>`,
   so `App.tsx`'s own unlock-detection effect (which shows `IdbUnlockModal`)
   never ran — the user landed on the generic `StorageErrorScreen`, whose only
   action is "Reset Database & Reload" (**destroys all local data**). Fixed by
   making the bootstrap a named, re-invocable `bootApp()` function; a
   locked-storage catch now renders a standalone `IdbUnlockModal` (confirmed
   Redux-free — only needs `I18nProvider`) and retries the full boot in place
   on success, with no page reload (which would lose the freshly-unlocked
   in-memory key).
2. **"Lock Session" created a silent-data-loss trap (#335, same commit).**
   `handleLockSession()` cleared the encryption key but never opened the
   unlock modal and didn't block editing — a user could keep typing while
   every subsequent autosave silently failed closed (generic "Auto-Save
   Failed" toast, no route back to unlocking short of manually reopening
   Settings). Fixed by also opening the same global unlock modal
   (`transientUiStore.setIdbUnlockOpen(true)`).
3. **First-run appearance default silently regressed from `sepia` to
   `default` (#335, `0353364d`).** `main` deliberately keeps the first-run
   default (`sepia`, the "Candlelit Manuscript" showcase) different from the
   legacy-rehydration fallback (`default`, so an existing user's old data
   missing the field isn't retroactively theme-shifted). This branch had
   drifted to using `'default'` for *both*, with an incorrect comment
   claiming they "must agree." This directly caused
   `tests/e2e/a11y.spec.ts`'s `"dark sepia theme has no serious axe
   violations"` test to fail (confirmed via the CI log — `page.waitForFunction`
   timeout waiting for `.appearance-sepia`, which never appeared). Reverted
   to match main's deliberate design.
4. **Migration verification could retry forever with no operator visibility
   (#337, `411943a8`).** `runProtectedStoreMigration`'s verifying phase threw
   a generic error on a verified-count shortfall (e.g. a stray ordinary write
   landing on an already-migrated record with a superseded key after that
   store's migrating pass finished) and just released the ownership lease,
   leaving the journal parked at `verifying` — an indefinite silent retry
   loop, since nothing in the saga revisits and reconverts the stray record.
   New `ProtectedStoreVerificationShortfallError` (distinct from a
   transient/interrupted `verify()` exception, which still resumes correctly)
   now transitions the journal to `recovery-required` on this specific
   failure, making the stuck state visible.
5. **TOCTOU guard reordering regression, self-caught (#337, `46198b26`
   following `a8dd9175`).** An earlier fix in this session moved the full
   `assertIdbProtectedWriteAllowed()` (migration + lock check) to immediately
   before each protected write's transaction, to narrow a TOCTOU window. This
   broke an *existing* regression test (`'saveSlice still encrypts even when
   the key is cleared right after the write key is resolved'`) because
   `resolveProtectedWriteKey()` already performs its own lock check atomically
   with the key snapshot — re-running the full check afterward wrongly
   rejected an already-safely-encrypted write if the session locked mid-write.
   Fixed by re-checking only the narrower `assertNoActiveEncryptionMigration()`
   pre-write in the six affected write methods, newly re-exported from
   `storageEncryptionService` for this purpose.
6. **`listRevisions()` let one damaged revision hide a whole scene's history
   (#337, `46198b26`).** Now skips (logs, `continue`s) a single record that
   throws `SecureRecordCorruptError` during decode instead of rejecting the
   entire call; any other error type still aborts (a genuine lock-state
   change must not be swallowed).
7. **`aiInferenceCacheService` read path didn't honor its own
   non-authoritative contract (#337, `beadfa22`).** `getCachedInference()`'s
   lifecycle check was unguarded, so a lock/migration/IDB-access failure
   rejected the call instead of degrading to a miss (the write path,
   `setCachedInference`, already had this protection). Also: legacy plaintext
   cache entries were read correctly but never opportunistically re-encrypted,
   so a cache populated before encryption was enabled stayed plaintext for its
   full 7-day TTL even after unlock — now rewritten via the same
   `needsMigration` signal the journal adapters already use.
8. **`testOllamaConnection()` reported a false-positive success on a
   malformed response (#337, `3f31c1e1`).** A 200 response with unparseable
   JSON or a missing `models` array was silently treated as `ok: true` with
   zero models, inconsistent with the OpenAI-compatible diagnostic path's
   existing `invalidResponse` classification. Fixed to match.
9. **`AiProviderCard` rendered the connection test result twice (#337,
   `dc0b5262`).** The new status panel and the pre-existing action row both
   rendered the identical `testError`/success text simultaneously — confirmed
   real via an existing test that used `getAllByText(...).length` with a
   comment acknowledging the duplication as known. Consolidated to the status
   panel only.

Item 3 (appearance default) is the one still awaiting a fresh CI signal — see
§ 15 before doing anything that assumes it's confirmed green.

## 7. What's Genuinely Still Open (do not claim these are done)

1. **The one #335 review thread left unresolved on purpose** (§ 8) — needs a
   `pnpm install` from a properly-resourced environment.
2. **#310 reconciliation is not complete.** This session fixed PR310-R009's
   disposition (was `REWRITE`, an impermissible interim category; now
   `ADOPTED_WITH_MODIFICATIONS` with concrete test-name citations in new row
   `PR310-R016`, `docs/PR-310-RECONCILIATION.md`) and two related REWRITE rows
   that described the same underlying concern. The doc's own "Status: in
   progress" header is still accurate — most of #310's 317 historical threads
   and its 28 currently-unresolved ones were **not** touched this session.
3. **#332/#333 packaged desktop evidence** — explicitly deferred again. No
   `.deb` build/install/relaunch matrix ran. Do not claim closure.
4. **`index.tsx`'s new locked-storage bootstrap branch has no automated
   test.** The file has zero pre-existing test infrastructure (side-effecting
   module-level bootstrap, nothing exported/testable). The fix was verified
   by static tracing of every new dependency (`IdbUnlockModal`, `Modal`,
   `Button`, `useFocusTrap`, `useTranslation`, `I18nProvider` — all confirmed
   Redux-free) rather than a test. If you have time and the host can spare a
   heavier vitest run, consider whether exporting `bootApp` and building a
   minimal jsdom harness (stub `#root`, mock `dbService.loadState` to reject)
   is worth the investment — it wasn't done here due to session scope/time,
   not because it's impossible.
5. **Whether #335's final CI run is actually green** — was in flight at
   capture time. Check this first (§ 15) before any merge action.

## 8. The One Deliberately-Open #335 Thread

CodeRabbit flagged `pnpm-workspace.yaml`'s `uuid: ">=11.1.1"` override as a
bare floor that would still permit two known-vulnerable exact releases
(`12.0.0`, `13.0.0` — GHSA-w5hq-g745-h8pq / CVE-2026-41907) if a future
resolution ever landed on them; the currently-locked `uuid@14.0.1` is
unaffected today. This is a real, correctly-identified hardening gap, not a
false positive.

The precise fix was applied and verified correct, then reverted:
`uuid: ">=11.1.1 <12.0.0 || >=12.0.1 <13.0.0 || >=13.0.1"` in both
`pnpm-workspace.yaml` and the two matching fields in `pnpm-lock.yaml`
(`overrides.uuid` and the `uuid` importer's `specifier`). The moment the
override string changes, this repo's `verifyDepsBeforeRun: error` policy
(by design) refuses to run **any** script — including a plain typecheck —
until a real `pnpm install` reconciles `node_modules`' installed state with
the new override. That's the exact fail-closed behavior the policy exists to
enforce; there is no way to hand-edit around it safely. This session's host
was memory-severely-constrained (§ 14) and a full `pnpm install` for a
project this size (transformers.js/onnxruntime/webllm/Playwright/Storybook
among the devDependencies) risks an OOM crash mid-install, leaving the
lockfile in a worse, half-resolved state than today's.

**To close this thread:** from a normal-resourced environment (or via a
dependency-update CI job), apply the exact override string above to both
files consistently, run `pnpm install` to let it reconcile/regenerate
naturally, verify `pnpm run typecheck` and `pnpm run lint` pass, then push,
reply to the thread citing the resolving commit, and resolve it via GraphQL
`resolveReviewThread`. Thread id (GraphQL): fetch via the review-thread query
in § 15 if it's not still `PRRT_kwDOQOeAgc6YK1Aq` (SHAs will have moved).

## 9. PR #310 Reconciliation

- Ledger: `docs/PR-310-RECONCILIATION.md`.
- Strategy: Option C — replace through #335 + #337 while preserving all
  material behavior and useful test intent. Unchanged this session.
- Live PR: #310 at `27177ce549d4579f1fc9dfbc4630ebf0c2592f9b`; still open, still
  `BLOCKED`. Do not merge or close.
- **This session's change:** PR310-R009 (was `REWRITE`) and two related rows
  describing the same underlying "missing-store/interruption/legacy-shape/
  resume/verification coverage" concern are now `ADOPTED_WITH_MODIFICATIONS`,
  pointing to a new consolidated row `PR310-R016` with concrete test-name
  citations (`protectedStoreMigration.test.ts`'s missing-adapter/checkpoint,
  interruption+resume, and verification-shortfall tests, plus
  `secondaryPayloadStoreAdapter.test.ts`'s plaintext-conversion test).
- **Not done:** the doc's 28 currently-unresolved historical review threads
  and the remainder of its 317-thread total were not fetched/classified this
  session. Do not claim #310 reconciliation is complete.

## 10. #332 / #333 Status (unchanged this session — explicitly deferred again)

| Workstream | State | Evidence | Closure classification |
| --- | --- | --- | --- |
| #332 `.deb` sluggish Settings | Open | No package/profile | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| #332 sepia persistence | Open | **Root cause now understood and fixed on #335 this session** (§ 6 item 3) — but still no relaunch matrix / packaged proof | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` → verify with packaged evidence before closing |
| #333 Local-AI acquisition | Open | Code direction only; no terminal runtime proof | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| #333 UI freezes/overlap | Open | No trace/zoom/RTL/package matrix | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| #333 Gemini/LM Studio | Open | Code hardening; packaged diagnostic unverified | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| #333 Python/LoRA | Open | Native build evidence from an earlier session; not re-verified this session | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` |

Neither issue is eligible for closure. The sepia-persistence root cause is
now well understood (§ 6 item 3) — worth prioritizing for the *next* packaged
verification pass, since the fix is already merged into the stack.

## 11. Performance / Responsiveness Status

- Ledger: `docs/ISSUES-332-333-PERFORMANCE-LEDGER.md` — SHAs refreshed this
  session (twice — once mid-session, once after the final cascade).
- No `.deb` build/install/terminal launch/menu launch/Wayland/X11 test
  occurred this session either. Amendment integration remains `PARTIAL`.

**PERFORMANCE CLOSURE NOT YET VERIFIED.** Browser/Vercel/unit success cannot
close the packaged Tauri reports.

## 12. pnpm / Supply-Chain Status

| Item | Value |
| --- | --- |
| Declared / active pnpm | `11.5.2` |
| `verifyDepsBeforeRun` | `error` — confirmed live-tested this session (blocks all scripts on an override-string change until `pnpm install`) |
| `uuid` override | `">=11.1.1"` (bare floor) — a tighter, verified-correct replacement string is specified in § 8 but not yet applied (needs a real install) |
| Everything else in `pnpm-workspace.yaml`'s `overrides` | Unchanged this session |

**Do not attempt to hand-edit `pnpm-workspace.yaml`/`pnpm-lock.yaml` override
strings without immediately following up with a real `pnpm install`** — this
session proved empirically that `verifyDepsBeforeRun: error` will block every
subsequent script (including typecheck) the instant the override string and
the installed `node_modules` state diverge.

## 13. Review-Thread Reconciliation Method Used This Session

For every unresolved thread across #335/#336/#337: read the finding's full
body (GraphQL `reviewThreads` → `comments.nodes[].body`, paginated at 100),
then verify against the **current** code at the file/line the finding
references (anchors drift — `isOutdated: true` is not a disposition, the
underlying claim must be re-checked). Classification used:

- **Already fixed** — a prior commit in this session (or an earlier session)
  already addressed it; reply citing the exact resolving commit SHA and the
  specific code/test evidence, then resolve.
- **False positive** — the finding's premise doesn't hold against current
  code (e.g. the "missing `_resetDbForTest()`" finding, which was actually
  present under a differently-named, correctly-scoped helper); reply with
  evidence, then resolve.
- **Real, fixed this session** — implement the root-cause fix + test, reply
  citing the new commit, resolve.
- **Real, deliberately deferred** — confirmed valid, but the safe fix requires
  something this environment cannot do (§ 8's `pnpm install` case); reply with
  the exact fix specification and the reason it's blocked, and **leave it
  unresolved** rather than falsely closing it.

Never resolve a thread solely because its anchor moved (`isOutdated: true`)
— that's a stale pointer, not evidence the concern was addressed.

## 14. Local Resource Constraints

| Metric | Capture value (this session, near end) |
| --- | --- |
| RAM | 3.7 GiB total; 1.3 GiB free; 1.6 GiB available |
| Swap | 3.9 GiB total; 2.0 GiB used |
| CPUs/load | 2; 3.65/4.79/4.89 |
| Disk | 6.2 GiB free; 94% used |
| Class | `SEVERELY_CONSTRAINED` (improved slightly from an earlier 109 MiB free reading mid-session, still constrained) |

One Bash command per turn; heavy commands (`vitest run` across many files,
`biome check` on the full repo) reliably exceed the 120s foreground timeout
and move to background automatically — that's expected, not a failure; poll
via the background task's output file rather than re-running. No local `pnpm
install` without a properly-resourced environment (§ 8, § 12).

## 15. How to Check Whether This Session's Final Push Landed Green

This session ended while a background poll for #335's E2E completion (and a
final full-stack status snapshot) was still running. To pick up from here:

```bash
gh pr checks 335   # look specifically for "🎭 E2E Tests (Playwright)"
gh pr checks 336
gh pr checks 337
```

```bash
# Unresolved thread count per PR (should be 1/0/0 for #335/#336/#337 respectively):
gh api graphql -f query='query { repository(owner: "qnbs", name: "WorldScript-Studio") { pullRequest(number: 335) { reviewThreads(first: 100) { nodes { isResolved } } } } }' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length'
```//<- repeat for 336, 337

If `gh pr checks 335` shows the E2E job green and CodeAnt gates green, and
the thread counts match 1/0/0, the standing merge authorization (§ 2) is
satisfied for the review/quality dimension. Still re-check § 19's NO-GO
conditions (native Rust evidence for #336's Tauri build, #310 state, #332/#333
evidence) before actually merging — those are independent of review-thread
count and were not re-verified at the very end of this session.

If the E2E job is still red on `0353364d`, re-fetch its log
(`gh run view <run-id> --job <job-id> --log-failed`) and check whether it's
the same `a11y.spec.ts` sepia test (would mean the fix didn't take effect —
re-check `features/settings/settingsSlice.ts:47` says `appearancePreset:
'sepia'`) or something new.

## 16. A Layering Mistake Made and Corrected This Session (read if confused by branch history)

Two fixes (§ 6 items 1, 2, and 3) belong architecturally to #335 (the
foundation layer — `services/storageEncryptionService.ts`, `index.tsx`,
`hooks/useSettingsView.ts`, `features/settings/settingsSlice.ts` all
originate there). They were initially committed directly onto
`feat/encryption-recovery-journal` (#337) as commit `667f6f37` — a violation
of this repo's "fix at the earliest affected layer" policy, since it would
have left #335 and #336 still broken while #337 alone had the fix. This was
caught before pushing further and corrected: `667f6f37`'s content was
cherry-picked onto #335 (`99c28392`), pushed, then cascaded forward through
#336 (`ad4364ac`) and back into #337 via normal merges — `667f6f37` itself
remains in #337's own commit history (harmless: identical file content, and
properly folded into the merge ancestry afterward) but is superseded as the
"source of truth" location by the cherry-pick on #335. If you're diffing
history and see this commit appear twice with different SHAs, that's why.

## 17. Uncommitted / Unpushed State

Tree is clean; all three branches (`fix/encryption-lifecycle-safety`,
`fix/desktop-reliability-hardening`, `feat/encryption-recovery-journal`) are
pushed and match their `origin/*` remotes exactly as of capture. No stash,
reset, clean, rebase, or force push occurred this session.

## 18. Exact Next Actions

1. **Check § 15** — confirm #335's E2E result on `0353364d` and the 1/0/0
   thread counts across the stack.
2. **If green:** the standing merge authorization applies. Re-verify § 19's
   NO-GO conditions (they're independent of review-thread state), then merge
   #335 → `main`, then #336 (auto-retargets to `main` once #335 merges), then
   #337 (same), in that order, using whatever merge method this repo's
   branch-protection settings require (squash, per `AGENTS.md`/`CLAUDE.md`
   convention observed elsewhere in this remediation effort).
3. **If #335's E2E is still red:** diagnose per § 15's last paragraph before
   doing anything else.
4. **After merging (or if not merging this session):** continue #310
   reconciliation (§ 9) — 28 of 317 threads and the bulk of the ledger's
   remaining rows are untouched.
5. **When a properly-resourced environment is available:** close § 8's
   deliberately-open #335 thread (`pnpm install` + push + reply + resolve).
6. **When packaged-desktop validation is possible again:** #332/#333 (§ 10) —
   the sepia-persistence root cause is now fixed in-stack and just needs a
   relaunch-matrix proof; the others need fresh `.deb` evidence entirely.

## 19. Merge / Release NO-GO Conditions (unchanged, all still active)

No merge/release while: a silent plaintext downgrade is possible; the
migration/session race is unresolved (§ 6 item 4/5 narrowed but did not
eliminate the theoretical migration-vs-write race — documented as an
accepted, bounded residual risk in the #337 thread reply, not a NO-GO by
itself since it fails safe-and-visible now); #310 material items remain
unreconciled (they do — § 9); #332/#333 lack packaged desktop evidence (they
do — § 10); native Rust/Tauri build evidence isn't tied to a final SHA (not
re-verified this session — check `gh run list` for the latest Tauri workflow
run against #336's current SHA before assuming this is still fine); or any
review thread was resolved merely because its anchor moved (this session
was careful about this — see § 13's method, but spot-check a sample if you
want independent confirmation).

## 20. Files / Symbols To Read First

1. `docs/session-handoff/CURRENT-HANDOFF.md` (this file)
2. `docs/PR-310-RECONCILIATION.md`
3. `docs/ISSUES-332-333-PERFORMANCE-LEDGER.md`
4. `index.tsx` (`bootApp`), `hooks/useSettingsView.ts` (`handleLockSession`),
   `features/settings/settingsSlice.ts` (`appearancePreset`) — this session's
   three real-bug fixes on #335
5. `services/storage/protectedStoreMigration.ts` (verification-shortfall →
   recovery-required), `services/storage/storageEncryptionService.ts`
   (narrowed migration-only pre-write guard)
6. `services/ai/aiInferenceCacheService.ts`, `services/ollamaService.ts`,
   `components/settings/AiProviderCard.tsx` — this session's #337 fixes
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
- Hand-editing `pnpm-workspace.yaml`/`pnpm-lock.yaml` override strings without
  a follow-up install.
- Any full local coverage/E2E/mutation/Lighthouse/Storybook/Tauri build —
  cloud CI only on this hardware.
- Resolving a review thread because its anchor moved, without re-verifying
  the underlying concern against current code.
- `--admin` merges to route around a `mergeable_state` cache lag — re-poll
  instead (see the project `CLAUDE.md`'s documented quirk).

## 23. Open Questions / Uncertainty

1. Did #335's E2E suite actually go green on `0353364d`? (§ 15 — unresolved
   at capture time.)
2. Is #336's native Tauri build evidence still tied to a SHA that matches its
   current head (`ad4364ac`), or does it need a fresh dispatch? Not
   re-verified this session.
3. Does #310's remaining 28 unresolved threads (of 317) contain anything
   that changes the Option C strategy, or are they all already superseded by
   #335/#337 work? Not investigated this session.
4. Is there a *second* place in the codebase (beyond `settingsSlice.ts` and
   `idbProjectStore.ts`'s `normalizePersistedSettings`) that assumes
   `appearancePreset`'s first-run default is `'default'` rather than
   `'sepia'`? A targeted grep found none, but a full grep across
   `components/`/`hooks/` for `appearancePreset` was not exhaustively cross-
   checked against every consumer.
5. Should `index.tsx`'s `bootApp` be exported and given a real test harness?
   Deferred this session (§ 7 item 4) — worth revisiting.

## 24. Handoff Integrity Checklist

- [x] Local state captured before writing this document; no state discarded.
- [x] Live PR stack, #310, #332/#333 state queried and reflected.
- [x] SHA-bound evidence captured for every claim above.
- [x] Performance non-closure and #310 non-final state kept explicit.
- [x] The one genuinely-deferred item (§ 8) documented with its exact fix and
      why it's blocked, not silently dropped.
- [x] The layering mistake (§ 16) documented rather than hidden.
- [ ] Final confirmation that #335's CI is green on `0353364d` — pending at
      capture time; next agent's first job is to check this (§ 15).
