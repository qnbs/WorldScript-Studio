# CEF Threading and Lifetimes

**Status:** Real, hands-on evidence from `apps/desktop-cef/` (PR #388) — the first genuine content this doc has ever had. Narrower than its full intended scope: UI-thread callback discipline and CEF ref-counting/callback-lifetime patterns are covered with real code + CI proof; IO-thread behavior, render-process-side code, and async cancellation are **not** touched at all yet.
**Scope:** UI-thread-only callback rules, IO-thread behavior, CEF's reference-counted object model, callback lifetime, renderer/browser process boundaries, async cancellation and object invalidation, and shutdown races — as they actually manifest in WorldScript's host implementation.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1 ("CEF threading and lifetime rules" domain), §4.11.4 (dual-review requirement for this exact area), Appendix A.1.

## Thread map: what we've actually proven (PR #388)

Every callback our code implements — `WorldScriptApp::OnContextInitialized`, `WorldScriptHandler::OnTitleChange`/`OnAfterCreated`/`DoClose`/`OnBeforeClose`/`PollShutdownFlag`, `WorldScriptWindowDelegate::OnWindowCreated`/`OnWindowDestroyed`/`CanClose` — runs on CEF's **UI thread**, enforced by `CEF_REQUIRE_UI_THREAD()` (a `DCHECK`-style assertion, not just a comment) at the top of each. This is CEF's own contract for these specific interfaces (`CefBrowserProcessHandler`, `CefLifeSpanHandler`, `CefDisplayHandler`, `CefWindowDelegate`) — we didn't have to manually dispatch anything onto the UI thread for these to be correct; CEF delivers them there itself.

**Not touched at all**: IO-thread behavior, render-process-side code (no `CefRenderProcessHandler` implemented — see `docs/cef/CEF-BINDING-DECISION-SCORECARD.md`'s "Renderer callbacks" row, which explicitly scores this as untested), and any cross-thread posting *other than* the one pattern below.

## Reference-counting discipline — a real gotcha found via CI, not review

Every CEF-facing class we wrote (`WorldScriptHandler`, `WorldScriptApp`, `WorldScriptWindowDelegate`, `WorldScriptBrowserViewDelegate`, `PollShutdownTask`) uses `IMPLEMENT_REFCOUNTING(ClassName)` — CEF's own ref-counted base (`CefBaseRefCounted`-derived interfaces), not Chromium's `base::RefCounted<T>`.

**The gotcha**: these are two *different* ref-counting schemes. Chromium's `base::BindOnce`/`base::Bind` has automatic ref-counting detection built for its *own* `base::RefCounted` family — it does **not** recognize CEF's `IMPLEMENT_REFCOUNTING` scheme the same way. Binding a bare `this` (a CEF ref-counted object) directly into `base::BindOnce(&Method, this)` produced a real compile failure on the actual CI build (`base::BindFailedCheckPreviousErrors`, "invalid use of incomplete type `OnceCallback<void()>`") — not caught by local review (no CEF SDK available to compile against locally), only by the CI-first loop actually building it. `base::Unretained(this)` fixed the *receiver* half of that error but not the underlying incomplete-type issue.

**What we shipped instead**: a plain `CefTask` subclass (`PollShutdownTask`, in `apps/desktop-cef/src/worldscript_handler.cpp`'s anonymous namespace) holding a `CefRefPtr<WorldScriptHandler> handler_` member, passed to the simpler `CefPostDelayedTask(CefThreadId, CefRefPtr<CefTask>, int64_t)` overload — sidestepping `base::Bind`'s template machinery entirely. `CefRefPtr<WorldScriptHandler>(this)` in the task's constructor calls `AddRef()`, genuinely extending the handler's lifetime for as long as the task holds it — a real lifetime guarantee, not just an "I promise this is safe" annotation like `base::Unretained` would have been.

## Callback lifetime pattern: the shutdown-poll chain

`WorldScriptHandler::OnAfterCreated` schedules the first `PollShutdownTask` via `CefPostDelayedTask(TID_UI, ..., 100ms)`. Each execution either (a) detects the shutdown flag set and calls `TryCloseBrowser()` on every tracked browser, stopping the chain, or (b) reschedules itself only `if (!browser_list_.empty())`. This means the polling chain **self-terminates** once the last browser closes (`OnBeforeClose` empties `browser_list_`) — no explicit cancellation call was needed, and no scheduled-but-orphaned tasks accumulate after the browser closes, confirmed by the clean process-tree check in `scripts/cef/run-launch-cycle-proof.mjs` across 3 repeated cycles.

## Shutdown races — one real one avoided, one real one found and worked around

- **Avoided by design**: CEF APIs are not async-signal-safe (confirmed via CEF's own docs during this investigation). `apps/desktop-cef/src/shutdown_signal.h`/`.cpp`'s SIGTERM/SIGINT handler does *only* an async-signal-safe `sig_atomic_t` flag write — no CEF call happens inside the signal handler itself. The actual `TryCloseBrowser()`/`OnBeforeClose()`/`CefQuitMessageLoop()` sequence runs from the polling task on the UI thread, a normal (non-signal-handler) context.
- **Found and worked around**: a renderer subprocess can still be alive for a short window after the main (browser) process itself has already exited — an immediate orphan-process check after the main process exits produced a false positive on the first real run that spawned a renderer (once an unrelated ICU/cwd startup bug was fixed — see `docs/cef/knowledge/subprocess-and-shutdown.md`). Worked around with a fixed grace period before checking, not a measured wait — see that doc for the precise, review-corrected wording.

## Repeated-startup/shutdown test results

Real, CI-run evidence — see `docs/cef/knowledge/subprocess-and-shutdown.md` and the `🧪 CEF Learning Harness` workflow's `scripts/cef/run-launch-cycle-proof.mjs` step (PR #388): 3/3 independently-verified clean cycles.

## Still open (not this doc's real content yet)

- IO-thread behavior — never touched.
- Render-process-side lifetime rules (`CefRenderProcessHandler`) — never implemented.
- Async cancellation of in-flight CEF work (e.g. a pending `CefPostDelayedTask` explicitly cancelled mid-flight, not just left to self-terminate as above).
- Object invalidation patterns beyond the one ref-counted-task pattern documented here.
- The full dual-review this doc's own header requires (roadmap §4.11.4) — this is one author's real findings, not yet an independent second review.
