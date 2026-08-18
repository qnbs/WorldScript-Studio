# CEF Linux Runtime Notes

**Status:** Preliminary spike evidence (2026-08-18, ADR-0020, one dev machine) plus real CI-run evidence (2026-08-18/19, PR #388, GitHub Actions `ubuntu-latest`) — two machines now, still one CEF version, X11 only. Not a compatibility contract yet; do not treat any number below as a floor until packaged builds prove it (§44.1). See "Second data point" below for the CI-runner evidence, and "Remaining outline" for what neither data point covers yet.
**Scope:** The Linux Runtime Compatibility Contract for WorldScript's CEF build — minimum supported distribution/runtime baseline, CPU architectures, required dynamic libraries/packages, `libcef.so`/resource layout, loader/rpath policy, X11 vs. Wayland policy, Ozone/backend policy, GPU/driver expectations, installer dependency behavior.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §44.1–§44.5 (Linux runtime compatibility as its own workstream), Appendix A.3 (compatibility matrix template).

## Spike evidence (2026-08-18, one machine only — see status above)

- **Distribution/version tested:** CEF 151.3.18 (Chromium 151.0.7922.138), linux64 **minimal** distribution, on Ubuntu 22.04 (glibc-based) — matches CEF's own officially-tested target for this CEF version per its shipped `CMakeLists.txt`.
- **Runtime shared-library dependencies:** every package CEF's build docs call out (`libnss3`, `libnspr4`, `libatk1.0-0`, `libatk-bridge2.0-0`, `libcups2`, `libdrm2`, `libgbm1`, `libxcomposite1`, `libxdamage1`, `libxfixes3`, `libxrandr2`, `libxkbcommon0`, `libpango-1.0-0`, `libcairo2`, `libasound2`, `libgtk-3-0`, `libx11-xcb1`, `libxcb1`) were **already present** on this dev machine at their latest Ubuntu 22.04 package versions — none needed fresh installation. This is one data point, not proof these are sufficient on a clean/minimal install (§44.3's clean-machine test is still open).
- **Build-time-only dependency, not a runtime one:** `libx11-dev` (for `pkg-config --exists x11`, used only by the CMake build's `FIND_LINUX_LIBRARIES` macro) — this is a compile-time header/pkg-config need, not something the *packaged* app requires on an end-user machine.
- **Display server:** X11 only, via Xvfb (virtual framebuffer, headless). **Wayland was not tested at all.** Do not extrapolate X11-working to Wayland-working — the roadmap's own explicit warning applies: "CEF uses Chromium" is not proof of Wayland correctness.
- **GPU:** integrated Intel graphics on this machine reported `Bay Trail Vulkan support is incomplete` and `Installed VAAPI version is too old (min 1.17, installed 1.14)`. Chromium fell back to software rendering (bundled SwiftShader) rather than crashing. This is a real, reproducible data point for exactly the kind of older/constrained-GPU Linux hardware the roadmap's compatibility matrix (Appendix A.3) needs to cover — not yet placed into that matrix formally since only one GPU/driver combination was observed.
- **Sandbox:** not exercised (`no_sandbox=true` for this spike). No data point here at all.

## Second data point: real rendering on GitHub Actions `ubuntu-latest` (2026-08-18/19, PR #388)

Distinct from the spike above — this is CI-run, repo-committed evidence via [`scripts/cef/run-launch-cycle-proof.mjs`](../../../scripts/cef/run-launch-cycle-proof.mjs) in the `🧪 CEF Learning Harness` job, not a manual spike:

- **A second machine, X11/Xvfb again, but this time rendering the real production bundle** (`pnpm run build`'s `dist/`, served over local HTTP), not just `about:blank`. Confirmed via the page's own console log line and its exact document title ("WorldScript Studio") observed in CEF's `OnTitleChange` callback.
- **`libcef.so`/resource layout observed for the first time on a real filesystem listing** (not just assumed from `COPY_FILES` macro behavior): `icudtl.dat`, `resources.pak`, `chrome_100_percent.pak`, `chrome_200_percent.pak`, `v8_context_snapshot.bin`, `locales/`, `libEGL.so`, `libGLESv2.so`, `libvk_swiftshader.so`, `libvulkan.so.1`, and `chrome-sandbox` all land correctly next to the executable via the two `COPY_FILES` calls in `apps/desktop-cef/CMakeLists.txt` — still CEF's own unpackaged build-output layout, not a real installer, but no longer just assumed.
- **A real startup-path bug found on this runner, unrelated to the dev-machine spike**: Chromium resolves several resource paths relative to the process's *working directory*, not the executable's own location — launching the binary from a different cwd (the repo root, as the CI step's default) produced `icu_util.cc: Invalid file descriptor to ICU data received` and an immediate crash, even with every required file correctly present. This is a genuine Linux-runtime-launch finding worth carrying forward into whatever eventually launches the packaged app (a desktop entry, a system service, a supervisor process) — it must set cwd correctly, or the equivalent Chromium flag/env override must be used instead.

## Explicit warning carried from the roadmap

> "CEF uses Chromium" is not accepted as proof of Wayland/X11 correctness (§44.2). Do not fill in this document with assumptions extrapolated from generic Chromium behavior — every claim here must come from an actual test run against WorldScript's build.

Do not hardcode a glibc/distro minimum here until packaged builds have proven it (§44.1). The Ubuntu 22.04 data point above is a spike observation on one machine, not a floor.

## Remaining outline (not yet done)

- Minimum distro/glibc floor **as proven by packaged builds**, not assumed (still open — Ubuntu 22.04 above is one dev-machine spike observation, not a proof)
- `libcef.so` and resource layout for our actual **packaging** (still not designed — PR #388 confirmed CEF's own unpackaged build-output layout copies correctly via `COPY_FILES`, on two machines now, but a real installer's layout is separate, later scope)
- X11 and Wayland smoke-test results across KDE, GNOME × NVIDIA, AMD, Intel (Appendix A.3 matrix) — this spike covers exactly one cell (X11/Xvfb, Intel integrated) of that matrix
- Sandbox requirements observed on Linux (not exercised this spike)
- Clean-machine dependency test results (§44.3) — **partially closed**: the `🧪 CEF Learning Harness` CI job (`.github/workflows/cef-learning-harness.yml`, `scripts/cef/check-linux-runtime-deps.mjs`) runs the same package-presence check against a stock `ubuntu-latest` runner, before any `apt-get`, giving a real second data point beyond this already-configured dev machine. Still open: only checks `dpkg` package presence, not `ldd` against the actual shipped `.so` files; only one distro/runner image; still not a packaged-installer dependency declaration
