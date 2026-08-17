# CEF Linux Runtime Notes

**Status:** Not started — no CEF integration exists yet in this repository.
**Scope:** The Linux Runtime Compatibility Contract for WorldScript's CEF build — minimum supported distribution/runtime baseline, CPU architectures, required dynamic libraries/packages, `libcef.so`/resource layout, loader/rpath policy, X11 vs. Wayland policy, Ozone/backend policy, GPU/driver expectations, installer dependency behavior.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §44.1–§44.5 (Linux runtime compatibility as its own workstream), Appendix A.3 (compatibility matrix template).

## Outline (to be filled in during Wave 2/3)

- Selected CEF distribution and its documented Linux dependency baseline
- Minimum distro/glibc floor **as proven by packaged builds**, not assumed
- `libcef.so` and resource layout for our packaging
- X11 and Wayland smoke-test results (KDE, GNOME × NVIDIA, AMD, Intel — Appendix A.3 matrix)
- Sandbox requirements observed on Linux
- Clean-machine dependency test results (§44.3)

## Explicit warning carried from the roadmap

> "CEF uses Chromium" is not accepted as proof of Wayland/X11 correctness (§44.2). Do not fill in this document with assumptions extrapolated from generic Chromium behavior — every claim here must come from an actual test run against WorldScript's build.

Do not hardcode a glibc/distro minimum here until packaged builds have proven it (§44.1).
