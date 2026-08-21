# GPUI Explorations — Deferred Native Feasibility Record

**Status:** EXPLORATORY — no implementation commitment

This record preserves the GPUI investigation targets that were previously listed as Waves 21–24
in `ROADMAP-QT-GPUI-DESKTOP.md`. GPUI remains a possible secondary Rust-native surface, but it is
not an active execution line while the first native product (Qt) has not completed its own
qualification and production waves.

## Why this is separate

The renderer-neutral Rust Core is valuable regardless of the eventual native UI choice and remains
active Wave-2 work. GPUI UI work is different: it would create a second native product line, add a
second framework supply chain, and create accessibility, text-input, packaging, and maintenance
obligations before Qt has produced evidence. Keeping GPUI here prevents an exploratory possibility
from becoming an implicit schedule commitment.

No GPUI implementation may begin from this document alone. Re-entry requires a reviewed decision
after Qt evidence exists, a maintained framework/version policy, and an explicit G6 admission
decision. The G6–G8 program gates remain future criteria, not completed work.

## Disposable exploration targets

If the exploration is re-authorized, use the smallest independent spikes necessary to falsify:

- application/window lifecycle and clean shutdown;
- manuscript text shaping and editor behavior;
- IME, RTL/BiDi, keyboard, focus, and accessibility-tree observability;
- clipboard, drag/drop, virtualized lists, graph/board surfaces, and large projects;
- GPU behavior and the target 120-Hz workload on supported hardware;
- direct consumption of the renderer-neutral Rust Core without React bindings;
- packaging, updater, crash diagnostics, recovery, and permission posture;
- the maintenance and bus-factor implications of GPUI itself and optional `gpui-component`.

Each spike must record its environment, maturity level, evidence link, residual risk, owner, and
retest condition. The maturity vocabulary remains:

```text
planned → locally proven → CI-proven → packaged-proven → admitted
```

## Explicit non-goals

- no GPUI shell or feature-parity program before G6;
- no manuscript, Plot Board, AI, task, settings, or import/export port as exploratory scope by
  implication;
- no speculative React-to-GPUI component reuse;
- no renderer-specific domain or encryption implementation;
- no Cargo-workspace unification or broad FFI introduced for exploration;
- no claim that GPUI is required for Qt success or for the Rust Core roadmap.

## Re-entry checklist

Before moving this record back into an execution roadmap, obtain all of the following:

1. Qt has reached the evidence level required by the current roadmap and its rollback window is
   understood.
2. The GPUI framework/version and dependency policy is approved, including update and bus-factor
   ownership.
3. Accessibility, IME/BiDi, editor performance, packaging/update, crash/recovery, and security
   feasibility are proven in disposable spikes at the appropriate maturity level.
4. A signed G6 GO decision accepts the residual risks and names the owner for the GPUI line.

Until then, this document is a preserved exploration backlog, not Wave 21.
