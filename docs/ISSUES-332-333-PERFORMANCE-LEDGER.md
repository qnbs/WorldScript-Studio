# Issues #332/#333 performance and desktop reliability ledger

Status: **active — no performance closure claim**. This ledger records measured
runtime evidence separately from code review and unit tests. It is the
authoritative closure record for the responsiveness portions of
[#332](https://github.com/qnbs/WorldScript-Studio/issues/332) and
[#333](https://github.com/qnbs/WorldScript-Studio/issues/333).

## Live baseline — 2026-08-12 (updated after the #336 second-wave CodeRabbit loop and the layering-mistake correction)

| Ref | Live value |
| --- | --- |
| `main` | `804793aa0815a726935785639e4fb139af7c4b59` |
| PR #335 | `edc3ef13c7f87007f290d3a60ee77b119ffeea57` (review threads: 0 unresolved of 40; all CI green) |
| PR #336 | `b01564ed77ae1acf9f9cb8c02ee4767e8909ef15` (review threads: 0 unresolved of 68) |
| PR #337 | `1335e81b` (review threads: 0 unresolved of 61) |
| PR #310 | `27177ce549d4579f1fc9dfbc4630ebf0c2592f9b` |
| Issue #332 / #333 | Open / Open; neither has post-report comments |

The `.npmrc`/`pnpm-workspace.yaml` uuid override-range hardening (previously deferred as
unsafe for this memory-constrained host to resolve via a real `pnpm install`) has since been
applied: a real `pnpm install --child-concurrency=1` succeeded once host load dropped, tightening
the override to exclude the two unpatched uuid releases (`edc3ef13`, resolved `uuid@14.0.1`
unchanged). That review thread is resolved; no deferred fix remains outstanding on #335.

`#335` is the lifecycle foundation, `#336` owns desktop, Local-AI, provider,
and Python reliability, and `#337` owns recovery-journal/secondary-store work.
Performance fixes belong to the earliest affected stack layer; this document
does not authorize moving a #336 defect into #337 merely because #337 is checked
out locally.

## Measurement contract

For a performance closure, retain a reproducible before/after measurement from
the same build mode and interaction. A browser result is not a substitute for
the packaged Linux Tauri result. The required runtime sequence is:

```text
reproduce → baseline → root cause → minimal fix → regression test
→ packaged desktop validation → after measurement → closure decision
```

The primary target is the installed Linux `.deb` under KDE/Wayland. When that
environment is unavailable, record the closest environment and use
`NOT_REPRODUCED_ENVIRONMENT_LIMITED`; do not infer a fix from Vite responsiveness.

## Findings

| ID | User symptom | Environment | Reproduced | Measurement | Leading cause / confidence | Fix / regression coverage | Packaged result | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PERF-332-001 | Severe Settings-category sluggishness in v1.26.0 `.deb` | Reporter: Ubuntu 26.04, KDE Plasma/Wayland, high-end Ryzen/RTX hardware | Not yet — packaged candidate has not been built/installed in this environment | Pending: open/switch P50/P95, long tasks, React commits, layout/paint, IDB/Tauri/probe counts | Shared renderer/native hot path not yet confirmed. Two concrete code-level contributing factors now confirmed and fixed (PR `fix/332-tauri-desktop-reliability`, D4/D5): (D5) `SettingsView`'s context value was rebuilt every render (no `useMemo`) and `useSettingsView` selected the entire live `project.present` (whole manuscript) non-shallowly, so any unrelated project mutation anywhere in the app re-rendered all of Settings; (D4) `backdrop-blur-*` GPU compositing (24 files, incl. shared Input/Textarea/Checkbox/RadioGroup/Card/Modal/Drawer/Toast primitives used throughout Settings) was only mitigated for OS-level `prefers-reduced-transparency`, never for direct Tailwind utility usage | D5: memoized `SettingsViewContext` value + narrowed project selector. D4: OS-preference block now also strips `backdrop-filter` on `backdrop-blur-*` utilities; new manual "Reduce transparency effects" toggle for DEs without the OS preference. Neither claimed to fully explain reporter-measured severity — still requires the packaged matrix | Pending `.deb` matrix | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` (contributing code factors fixed; overall severity unconfirmed without packaged measurement) |
| PERF-332-002 | Appearance preference, notably sepia disable, resets after restart | Packaged desktop and encryption-state matrix required | Not yet end-to-end | Pending durable-write and relaunch measurements | **Root cause confirmed** (PR `fix/332-tauri-desktop-reliability`, D1): `index.tsx`'s `bootApp()` called the raw IndexedDB-only `dbService.loadState()` unconditionally at cold boot, with zero Tauri branching — every save path (`listenerMiddleware.ts` autosaves, the `visibilitychange` flush) correctly routed through the Tauri-aware `storageService`, but nothing was ever read back on desktop. Every launch hydrated as a brand-new user; this is a strict superset of the reported symptom (not just `appearancePreset` — the entire project/settings state). D2: `idbProjectStore.ts`'s `normalizePersistedSettings` backstop default (`'default'`) also disagreed with `settingsSlice.ts`'s deliberate `'sepia'` initial state, reconciled for the true first-ever-launch case. D3: added an unconditional flush-on-quit (`onCloseRequested` now awaits `flushPersistedState`) so quitting mid-debounce can no longer drop the last edit | D1: `loadPersistedRootState()` now branches on `isTauriRuntime()` and reads via `storageService.loadSettings()`/`loadProject()` on desktop, mirroring the save path. D2: normalizer default aligned to `'sepia'`. D3: `services/desktop/desktopTray.ts`'s `installCloseToTray` awaits a flush callback before allowing a real quit. Unit tests cover D1 (boot-branch selection), D2 (default/migration), D3 (await-before-close ordering) | Pending terminal and desktop-menu relaunch — this is this repo's own bar for final closure even with the code-level root cause confirmed | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| PERF-333-001 | Local-AI acquisition appears frozen | Local-AI Settings and packaged desktop | Not yet measured on candidate package | Pending first-progress, progress-event gap, terminal state, cancel/retry settlement | Acquisition and inference progress must be distinct; code review identifies stuck-state risks | Existing retry/cancel changes require terminal-path proof | Pending `.deb` | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| PERF-333-002 | General UI freeze/slowness | Browser, Tauri dev, installed `.deb` | Not yet | Pending long tasks, paint/layout, native invokes, idle CPU | May overlap PERF-332-001; no shared cause claimed before trace. See PERF-332-001's D4/D5 entries — the same `SettingsView` re-render and `backdrop-blur` factors apply wherever those primitives/selectors are used outside Settings too | Same D4/D5 fixes as PERF-332-001 (not scoped to Settings alone) | Pending | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| PERF-333-003 | Scrolling/panel/text overlap | Required resolution/zoom/locale/RTL matrix | Not yet | Screenshot/visual and overflow inspection pending | Layout root cause unknown for this issue. Note: a related but distinct manuscript/writer-studio text-legibility defect (issue #341 — occlusion, font mismatch, no scroll sync) was independently root-caused and fixed in PR `fix/341-writer-studio-rendering` (merged as PR #344) — do not conflate the two; #341's fix does not close this row | Existing desktop audit is hypothesis-only for this specific symptom | Pending | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| PERF-333-004 | Python detection/probing contributes to desktop instability | Tauri desktop, terminal versus menu launch | Code inspection required on #336 | Pending candidate count, per-candidate and total duration | Synchronous probe risk must be confirmed or disproved | Pending `spawn_blocking`/timeout/cache assessment | Pending | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` |
| PERF-333-005 | Duplicate LoRA jobs or cancellation leaves resource load | Tauri desktop | Code inspection required on #336 | Pending concurrent-spawn/termination evidence | Atomic slot and confirmed child termination required | Pending | Pending | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` |
| PERF-333-006 | Local backend diagnostics cause stale/repeated work | Provider Settings, LM Studio/Ollama/vLLM | Unit/code evidence exists; runtime not measured | Pending request count, timeout and stale-result measurements | Requests must be user-triggered, abortable, deduplicated | #336 review reconciliation complete (0 unresolved of 68 threads at `b01564ed`) | Pending `.deb` | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |

## Required packaged desktop matrix

| Mode | Settings switch | Appearance relaunch | Local AI state | Provider/Python action | Wayland/X11 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Vite development | Pending | Pending | Pending | Pending | N/A | Pending |
| Production preview | Pending | Pending | Pending | Pending | N/A | Pending |
| Tauri dev | Pending | Pending | Pending | Pending | Pending | Pending |
| Installed `.deb` from terminal | Pending | Pending | Pending | Pending | Pending | Pending |
| Installed `.deb` from desktop menu | Pending | Pending | Pending | Pending | Pending | Pending |

## Initial budgets — to calibrate after baseline

- A Settings category interaction acknowledges in under 100 ms and normally
  visibly settles within 250 ms.
- A routine switch creates no unrelated network, local-server, Python, WebGPU,
  model-discovery, encryption-migration, or large-storage operation.
- No routine application-owned main-thread block exceeds 100 ms.
- Explicit heavyweight actions acknowledge immediately, report truthful progress,
  and settle cancel/retry into one terminal state (`ready`, `error`, or
  `cancelled`).

These are acceptance targets, not fabricated current measurements. A packaged
measurement can adjust a target only with recorded rationale; no target may be
relaxed merely to make a regression appear green.

## Hard closure gates

Neither performance issue can close until a candidate `.deb` has been built,
installed, launched from both a terminal and the desktop menu, exercised through
the relevant matrix, and compared before/after where the original symptom is
reproduced. CI, Vercel, code review, and browser-only responsiveness remain
necessary but insufficient evidence.
