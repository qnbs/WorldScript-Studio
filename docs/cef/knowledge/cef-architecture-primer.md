# CEF Architecture Primer

**Status:** Real evidence from `apps/desktop-cef/` (PR #388) for process model, message loop, and subprocess packaging; crash reporting and renderer-crash resilience proven in CI (PR #392). Sandbox configuration, dump symbolization, and a directly-observed full process-tree snapshot remain open.
**Scope:** How CEF's multi-process architecture (browser process, renderer process, GPU/utility processes; browser/frame/client ownership; message-loop integration; subprocess launch and packaging; sandbox model) maps onto WorldScript Studio's specific host and build, written from our actual integration — not a generic CEF tutorial.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1 ("CEF architecture" domain), §4.11.2, Wave 2.

## Process model, as implemented (`apps/desktop-cef/src/main.cpp`)

`worldscript_host` is a single executable re-executed by CEF itself for every process role — there is no separate subprocess binary. `main()` calls `CefExecuteProcess(main_args, app.get(), nullptr)` *before* anything else; a non-negative return means *this invocation* is a subprocess (renderer/GPU/utility) that has already run to completion, and `main()` returns immediately. Only when that call returns `-1` (this is the actual browser process) does the code proceed to install the shutdown-signal handler, call `CefInitialize`, and enter the message loop.

This single-binary-multi-role design is directly why `scripts/cef/run-launch-cycle-proof.mjs`'s orphan check anchors its `pgrep` pattern to the *start* of the binary's own path (`^${binaryPath}`) — every subprocess CEF spawns re-execs that exact same path with different flags (e.g. `--type=renderer`), so they're all catchable by one pattern, and nothing else on the system should share that literal path prefix.

**Directly observed evidence a renderer process exists and runs the real page**: the CI log for a real production-bundle load shows a `[INFO:CONSOLE:95]` line — a JavaScript console message relayed from the renderer process back to the browser process via CEF's own IPC, not something the browser process could produce itself. **GPU process**: not directly observed by name (no `ps`/`--type=gpu-process` capture was taken), but the build output includes `libvk_swiftshader.so`/`libvulkan.so.1` (Vulkan software rendering) and the ADR-0020 spike separately observed real GPU-fallback warnings (`Bay Trail Vulkan support is incomplete`) — consistent with a GPU process existing and falling back to software rendering, not confirmed as a distinct observed process in this specific proof.

## Browser/frame/client ownership, as implemented

- `WorldScriptApp::OnContextInitialized` creates exactly **one** `CefBrowserView` (`CefBrowserView::CreateBrowserView`) wrapped in exactly one top-level `CefWindow` (`CefWindow::CreateTopLevelWindow`) — single-window, single-browser, by design; nothing in this host creates additional windows or popups.
- `WorldScriptHandler` is the `CefClient` implementation and the sole owner of browser-lifecycle bookkeeping: a `std::list<CefRefPtr<CefBrowser>> browser_list_`, appended to in `OnAfterCreated` and pruned in `OnBeforeClose`. The list shape supports more than one browser in principle, but only one is ever created today.
- Frame-level ownership (multiple frames per browser, cross-frame navigation) has not been touched at all — the production bundle loads as a single top-level document.

## Message-loop choice and why

`CefRunMessageLoop()` (the blocking, OS-native-integrated variant) — not `CefDoMessageLoopWork()` in a manual polling loop — matching the standard `cefsimple` convention and avoiding a busy-poll CPU cost. `WorldScriptHandler::OnBeforeClose` calls `CefQuitMessageLoop()` only once `browser_list_` becomes empty, which is the actual mechanism that makes `CefRunMessageLoop()` in `main()` return — the real, CI-proven signal that it's safe to call `CefShutdown()`. See `docs/cef/knowledge/subprocess-and-shutdown.md` for the full shutdown sequence.

## Subprocess launch and packaging, as implemented

`apps/desktop-cef/CMakeLists.txt` runs two `COPY_FILES` calls (`CEF_BINARY_FILES`, `CEF_RESOURCE_FILES`) that land everything the runtime needs next to the executable — confirmed via a real `ls -la` in CI (PR #388), not just assumed from the macro's documented behavior: `libcef.so`, `icudtl.dat`, `resources.pak`, `chrome_100_percent.pak`, `chrome_200_percent.pak`, `v8_context_snapshot.bin`, `locales/`, `libEGL.so`, `libGLESv2.so`, `libvk_swiftshader.so`, `libvulkan.so.1`, and `chrome-sandbox`. **This is CEF's own unpackaged build-output layout** (`cmake --build` output, run in place) — not a real installer's layout, which is separate, later, unproven scope.

A real launch-path bug was found and fixed here too: Chromium resolves several of these resource paths relative to the process's *working directory*, not the executable's own location — launching the binary from a different cwd produced an ICU-init crash despite every file being correctly present. See `docs/cef/knowledge/linux-runtime-notes.md` for the full finding.

## Accessibility API — a real blocker found, not yet worked around

An attempt was made (2026-08-19, PR #391) to implement `CefAccessibilityHandler` on `WorldScriptHandler`, returned from a `CefClient::GetAccessibilityHandler()` override, following the pattern every other handler type in this codebase uses (`GetLifeSpanHandler`, `GetDisplayHandler`). **This does not compile against CEF 151.3.18** — the actual compiler error was explicit: `'CefRefPtr<CefAccessibilityHandler> WorldScriptHandler::GetAccessibilityHandler()' marked 'override', but does not override`. `CefClient` simply does not declare this getter in this CEF version, contradicting the assumption (drawn from older CEF documentation/examples) that it would.

The attempt was fully reverted rather than left half-working: `browser->GetHost()->SetAccessibilityState(STATE_ENABLED)` and a `--force-renderer-accessibility` command-line switch (both real, confirmed-to-compile CEF/Chromium APIs, unrelated to the `GetAccessibilityHandler` issue) were tried as a fallback with no observability attempt, but the very next CI run showed the previously 100%-reliable FFI-boundary and rendering proofs failing to produce any output at all — a regression serious enough that isolating its exact cause needs a real CEF SDK to compile and test against locally, not another blind CI round-trip on this constrained dev machine (see ADR-0020's own disk/RAM constraints). `apps/desktop-cef/` was reverted to byte-identical with what's on `main`.

**What this means for the next attempt**: the correct modern CEF 151 mechanism for accessibility tree observation is genuinely unknown as of this doc's writing — it needs real API research (current CEF source/docs, not assumptions carried from older versions or generic Chromium knowledge) before writing any more code against it. `accessibility_smoke` stays `false` in the competency manifest; the Early Accessibility Gate remains unattempted-with-a-working-mechanism, not "attempted and passed."

## Crash reporting — a real, working proof (with an honest limit)

Unlike the accessibility attempt above, every mechanism here was verified against the pinned CEF branch's actual source (`chromiumembedded/cef` branch `7922`, matching `151.0.7922.138`) before any code was written — the same discipline the "what this means for the next attempt" note above called for.

**A real, and initially surprising, correction to CEF's own docs**: `docs/crash_reporting.md` in the CEF repo states crash reporting is "implemented using Crashpad on Windows and macOS, and Breakpad on Linux." That is stale relative to this exact branch's source. `libcef/common/crash_reporting.cc`'s `InitCrashReporter()` calls `crash_reporter::InitializeCrashpad(...)` unconditionally for every non-Mac POSIX process (Linux included) — Linux uses **Crashpad** too in this CEF version, not Breakpad. This was confirmed, not assumed, before relying on it: reading `libcef/common/crash_reporter_client.cc`'s `GetCrashDumpLocation()` showed the `BREAKPAD_DUMP_LOCATION` environment variable (a legacy name, kept for compatibility) still overrides the dump directory on POSIX, and CI evidence (below) confirmed a real Crashpad database layout (`pending/`, `.meta`, `settings.dat`), not a Breakpad one.

**What's implemented** (`apps/desktop-cef/resources/crash_reporter.cfg`, `CMakeLists.txt`, `main.cpp`, `worldscript_handler.{h,cpp}`): `crash_reporter.cfg` (format from `include/cef_crash_util.h`) is copied next to the built executable via a `configure_file` step; `main.cpp` logs `CefCrashReportingEnabled()` after `CefInitialize`; `WorldScriptHandler` now also implements `CefRequestHandler` and overrides `OnRenderProcessTerminated` — a real method (confirmed present in `include/cef_client.h`'s `GetRequestHandler()`, unlike the accessibility handler) that fires in the browser process when a renderer subprocess dies, without the browser process itself going down.

**Directly observed evidence, PR #392, `🧪 CEF Learning Harness` CI job**: the harness launches `worldscript_host --url=chrome://crash` (the same debug URL CEF's own `cefclient` reference app uses to test this exact path) with `BREAKPAD_DUMP_LOCATION` pointed at a fresh, empty temp directory. The CI log shows `crash_reporting_enabled = true`, then `renderer_terminated status=TS_PROCESS_CRASHED error_code=...`, then — after the harness's usual graceful-shutdown sequence — three real files in that directory: `pending/<uuid>.dmp`, `pending/<uuid>.meta`, and `settings.dat`. The browser process's own clean-shutdown proof (same mechanism as the repeated start/close cycles) passed too, confirming process isolation held: only the renderer subprocess died.

**What this does NOT prove**: symbolization — decoding the `.dmp` file into a human-readable stack trace — needs `dump_syms` and `minidump_stackwalk`, which CEF's own docs say must be built from a *complete Chromium source checkout* (`gn`/`ninja`, hours of build time, tens of GB of disk). That is out of reach of this project's minimal-CEF-SDK-only CI setup (and of the local dev machine's own constrained RAM/disk, per this repo's own low-end-hardware guidance) and was not attempted. `crash_symbolization_smoke` in `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md` stays `false` for that reason — the crash-*reporting* half is proven; symbolization is a separate, still-open item.

## Sandbox configuration, as shipped

`chrome-sandbox` is present in the output directory (copied automatically as part of `CEF_BINARY_FILES`) but is **not used** — `main.cpp` sets `CefSettings.no_sandbox = true` unconditionally. Zero evidence exists on real sandbox posture; this is explicitly tracked as "Not yet attempted" in `docs/architecture/native-readiness.md` and `false` in the competency manifest.

## Process tree — what we can honestly claim

```text
worldscript_host (browser process, no_sandbox=true)
└── worldscript_host --type=renderer ... (confirmed indirectly: console-log IPC observed;
    not directly captured by ps/process-name in this proof)
└── (likely) worldscript_host --type=gpu-process ... (consistent with SwiftShader/Vulkan
    files present and GPU-fallback warnings from the ADR-0020 spike; not directly observed
    by process name in PR #388's own CI run)
```

Not a diagram of the generic CEF process model — this is what PR #388's evidence actually supports, with each claim's confidence level stated rather than assumed. A real `ps`/process-tree capture during a live run would upgrade the two `(likely)`/"not directly observed" lines to confirmed evidence; that capture has not been taken yet.
