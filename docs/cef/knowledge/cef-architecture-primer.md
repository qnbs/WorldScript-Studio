# CEF Architecture Primer

**Status:** Real evidence from `apps/desktop-cef/` (PR #388) for process model, message loop, and subprocess packaging; crash reporting and renderer-crash resilience proven in CI (PR #392); Wayland display-server smoke also proven in CI (PR #393), alongside X11; accessibility state enablement proven in CI with zero regression (PR #397). Sandbox configuration, dump symbolization, a real GPU/compositor matrix, accessibility-tree observability (AT-SPI), and a directly-observed full process-tree snapshot remain open.
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

## Accessibility API — first blocker found and root-caused, second attempt in progress

**First attempt (2026-08-19, PR #391)**: implemented `CefAccessibilityHandler` on `WorldScriptHandler`, returned from a `CefClient::GetAccessibilityHandler()` override, following the pattern every other handler type in this codebase uses (`GetLifeSpanHandler`, `GetDisplayHandler`). **This does not compile against CEF 151.3.18** — the actual compiler error was explicit: `'CefRefPtr<CefAccessibilityHandler> WorldScriptHandler::GetAccessibilityHandler()' marked 'override', but does not override`. A same-PR fallback (`SetAccessibilityState` + `--force-renderer-accessibility`, no observability) caused an unrelated regression in the FFI/rendering proofs; both changes were fully reverted rather than left half-working.

**Root cause, found on the second attempt (2026-08-19, PR #397)**: `GetAccessibilityHandler()` is real, but it's declared on `CefRenderHandler`, not `CefClient` (`include/cef_render_handler.h`, verified against the pinned CEF branch's actual source) — and `CefRenderHandler`'s own doc comment states it is for "handling events when window rendering is disabled" (OSR mode only). `worldscript_host` uses windowed rendering (`CefBrowserView`/`CefWindow`), so that method was never reachable here regardless of what `WorldScriptHandler` inherited from — PR #391's blocker had a real, findable, version-independent cause, not a moving target.

**What PR #397 does instead**: `CefBrowserHost::SetAccessibilityState(STATE_ENABLED)` alone, called in `OnAfterCreated` — `SetAccessibilityState`'s own doc comment (`include/cef_browser.h`) confirms windowed browsers need only this one call: "all platform accessibility objects will be created and managed by Chromium's internal implementation," no `CefAccessibilityHandler` required. This is a small, isolated addition (one call, one proof line, no new class inheritance).

**Directly observed evidence, PR #397, `🧪 CEF Learning Harness` CI job**: `[launch-cycle-proof] OK — 3/3 repeated start/close cycles clean, FFI boundary, real rendering, and accessibility-state request all proven in every cycle.` The crash-reporting and Wayland proofs both remained green in the same run — this addition caused no regression to the already-proven proofs (unlike PR #391's fallback attempt). One transient first-attempt CI timeout on cycle 1 (browser never reached `OnAfterCreated` within the grace period) reproduced the exact shape of the runner-speed variance already documented for `STARTUP_GRACE_MS` elsewhere in this file, and did not recur on a clean re-run — treated as CI-runner noise, not a code-shaped regression, consistent with that established precedent.

**What this proves**: accessibility state can be enabled intentionally, on every launch, with zero regression to existing proofs (roadmap §23.1's first bullet). **What it does NOT prove**: that the platform accessibility tree is actually observable — Chromium's windowed-mode accessibility integration registers with the OS's native accessibility bus (AT-SPI on Linux) rather than exposing a CEF-level callback, so verifying the tree exists needs OS-level AT-SPI introspection in CI, not a C++ handler. That remains separate, unattempted follow-up work. `accessibility_smoke` stays `false` in the competency manifest until both halves have real evidence.

## Crash reporting — a real, working proof (with an honest limit)

Unlike the accessibility attempt above, every mechanism here was verified against the pinned CEF branch's actual source (`chromiumembedded/cef` branch `7922`, matching `151.0.7922.138`) before any code was written — the same discipline the "what this means for the next attempt" note above called for.

**A real, and initially surprising, correction to CEF's own docs**: `docs/crash_reporting.md` in the CEF repo states crash reporting is "implemented using Crashpad on Windows and macOS, and Breakpad on Linux." That is stale relative to this exact branch's source. `libcef/common/crash_reporting.cc`'s `InitCrashReporter()` calls `crash_reporter::InitializeCrashpad(...)` unconditionally for every non-Mac POSIX process (Linux included) — Linux uses **Crashpad** too in this CEF version, not Breakpad. This was confirmed, not assumed, before relying on it: reading `libcef/common/crash_reporter_client.cc`'s `GetCrashDumpLocation()` showed the `BREAKPAD_DUMP_LOCATION` environment variable (a legacy name, kept for compatibility) still overrides the dump directory on POSIX, and CI evidence (below) confirmed a real Crashpad database layout (`pending/`, `.meta`, `settings.dat`), not a Breakpad one.

**What's implemented** (`apps/desktop-cef/resources/crash_reporter.cfg`, `CMakeLists.txt`, `main.cpp`, `worldscript_handler.{h,cpp}`): `crash_reporter.cfg` (format from `include/cef_crash_util.h`) is copied next to the built executable via a `configure_file` step; `main.cpp` logs `CefCrashReportingEnabled()` after `CefInitialize`; `WorldScriptHandler` now also implements `CefRequestHandler` and overrides `OnRenderProcessTerminated` — a real method (confirmed present in `include/cef_client.h`'s `GetRequestHandler()`, unlike the accessibility handler) that fires in the browser process when a renderer subprocess dies, without the browser process itself going down.

**Directly observed evidence, PR #392, `🧪 CEF Learning Harness` CI job**: the harness launches `worldscript_host --url=chrome://crash` (the same debug URL CEF's own `cefclient` reference app uses to test this exact path) with `BREAKPAD_DUMP_LOCATION` pointed at a fresh, empty temp directory. The CI log shows `crash_reporting_enabled = true`, then `renderer_terminated status=TS_PROCESS_CRASHED error_code=...`, then a real `pending/<uuid>.dmp` file — the one artifact the harness actually asserts on (`endsWith('.dmp')`, waited for before shutdown) — alongside `pending/<uuid>.meta` and `settings.dat`, Crashpad's own housekeeping files that were also observed in that directory but are not independently checked by the harness. The browser process's own clean-shutdown proof (same mechanism as the repeated start/close cycles) passed too, confirming process isolation held: only the renderer subprocess died.

**What this does NOT prove**: symbolization — decoding the `.dmp` file into a human-readable stack trace — needs `dump_syms` and `minidump_stackwalk`, which CEF's own docs say must be built from a *complete Chromium source checkout* (`gn`/`ninja`, hours of build time, tens of GB of disk). That is out of reach of this project's minimal-CEF-SDK-only CI setup (and of the local dev machine's own constrained RAM/disk, per this repo's own low-end-hardware guidance) and was not attempted. `crash_symbolization_smoke` in `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md` stays `false` for that reason — the crash-*reporting* half is proven; symbolization is a separate, still-open item.

## Display server — X11 proven since PR #388, Wayland now also proven

Roadmap §44.2 is explicit: *"'CEF uses Chromium' is not accepted as proof of Wayland/X11 correctness."* Until PR #393 this host had only ever been exercised under X11 (`xvfb-run`).

**Real evidence gathered before attempting anything**, matching the discipline the accessibility attempt's own "what this means for the next attempt" note called for: Chromium's own upstream GN default (`build/config/ozone.gni`, the `is_linux` branch) compiles **both** the `x11` and `wayland` Ozone platforms into every standard Linux build (`ozone_platform_wayland = true`), and CEF's own `tools/gn_args.py` has zero ozone/wayland overrides — confirmed by reading both files directly. `--ozone-platform=wayland` is a real, verified Chromium switch (`ui/ozone/public/ozone_switches.cc`'s `kOzonePlatform`).

**Directly observed evidence, PR #393**: `scripts/cef/run-wayland-smoke.mjs` launches a headless Weston compositor (`weston --backend=headless-backend.so` — the Wayland-side equivalent of Xvfb, no real display/GPU needed) and the *exact same already-built* `worldscript_host` binary under `--ozone-platform=wayland`, `WAYLAND_DISPLAY` pointed at Weston's socket. The CI log shows the compositor socket created, then `worldscript_host` reaching both `rust_core ping = 424242` and `title = WorldScript Studio` within about 1.2 seconds — the same two proofs the X11 harness uses, now also true under Wayland, on a stock GitHub Actions runner, first attempt.

**What this does NOT prove**: roadmap §44.2/§44.5's real matrix — NVIDIA/AMD/Intel GPUs × KDE/GNOME compositors × real graphics hardware. This is one virtual CI runner, one compositor implementation (Weston, headless, no GPU), non-blocking (`continue-on-error`) in CI. It answers "does the fetched CEF binary distribution and this host even support Wayland at all" (yes), not "does WorldScript Studio work correctly under every real-world Wayland desktop" (unproven).

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
