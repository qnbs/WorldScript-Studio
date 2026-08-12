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
| PERF-332-001 | Severe Settings-category sluggishness in v1.26.0 `.deb` | Reporter: Ubuntu 26.04, KDE Plasma/Wayland, high-end Ryzen/RTX hardware | Not yet — packaged candidate has not been built/installed in this environment | Pending: open/switch P50/P95, long tasks, React commits, layout/paint, IDB/Tauri/probe counts | Shared renderer/native hot path not yet confirmed | Existing removal/deferment work is code evidence only | Pending `.deb` matrix | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| PERF-332-002 | Appearance preference, notably sepia disable, resets after restart | Packaged desktop and encryption-state matrix required | Not yet end-to-end | Pending durable-write and relaunch measurements | Default/rehydration/encryption/storage-path interaction not yet confirmed | Foundation changed defaults; this is not proof of persistence | Pending terminal and desktop-menu relaunch | `ROOT_CAUSE_CONFIRMED_FIX_PENDING` |
| PERF-333-001 | Local-AI acquisition appears frozen | Local-AI Settings and packaged desktop | Not yet measured on candidate package | Pending first-progress, progress-event gap, terminal state, cancel/retry settlement | Acquisition and inference progress must be distinct; code review identifies stuck-state risks | Existing retry/cancel changes require terminal-path proof | Pending `.deb` | `FIXED_CODE_ONLY_AWAITING_PACKAGED_VERIFICATION` |
| PERF-333-002 | General UI freeze/slowness | Browser, Tauri dev, installed `.deb` | Not yet | Pending long tasks, paint/layout, native invokes, idle CPU | May overlap PERF-332-001; no shared cause claimed before trace | No performance closure yet | Pending | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
| PERF-333-003 | Scrolling/panel/text overlap | Required resolution/zoom/locale/RTL matrix | Not yet | Screenshot/visual and overflow inspection pending | Layout root cause unknown | Existing desktop audit is hypothesis-only | Pending | `NOT_REPRODUCED_ENVIRONMENT_LIMITED` |
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
