# A0.1 — Large-Manuscript Performance Harness

The baseline that the **Local-First (Y.Doc-as-source-of-truth) migration** is judged against. Before
any Track-B work touches the editor, these numbers must exist; after the migration, they must not
regress. See the strategic plan §2.4 (perf risk), §4 (Phase 0), §7 (risk table), §8 (first action).

## Why this exists

`StorySection.content` is a single string inside the `redux-undo`-wrapped `project` slice. At
50k–150k words, the per-keystroke cost (an immer `produce` over the whole project plus a 100-deep
undo snapshot), full-project serialization on save, and ProForge's full-manuscript text assembly are
**unmeasured**. This harness measures them so the CRDT rearchitecture is an evidence-based decision,
not a guess — and so a migration that silently makes typing slower is caught.

## Run it

```bash
pnpm bench                 # all benches against the ~120k-word fixture
pnpm exec vitest bench --run tests/bench/manuscript.bench.ts   # one file
```

Low-end hardware: run as a **single process** (no concurrent lint/typecheck/vitest). The `time`
budgets per bench are intentionally small (~250 ms) to keep total runtime and RAM bounded.

## What each bench means

| Bench | Hot path it stands in for | What a regression implies |
|---|---|---|
| `typing: updateManuscriptSection …` | One keystroke in the editor (immer produce + undo snapshot, steady-state 100-deep history) | Editor input lag on large manuscripts |
| `undo: ActionCreators.undo()` | Ctrl+Z from a full history | Undo jank |
| `save: JSON.stringify(project)` | IDB / Tauri persist payload build | Auto-save stalls |
| `snapshot: structuredClone(project)` | Per-keystroke snapshot memory/CPU | Memory pressure / GC pauses |
| `analytics: full word count` | Progress tracker / analytics recompute | Stat-panel jank |
| `proforge: intake assembly` | ProForge proof/diagnostic text assembly before any AI call | Slow pipeline start |

## Recording & comparing baselines

The fixture is **deterministic** (seeded LCG, fixed lexicon — no `Math.random`/`Date.now`), so
`hz`/mean are comparable run-to-run on the same machine. Numbers are machine-specific, so we do **not**
commit a baseline value into git; instead, record one per environment when you need a comparison:

```bash
pnpm exec vitest bench --run tests/bench --outputJson tests/bench/baseline/local.json
# …make a change (e.g. the Y.Doc shadow-doc), then compare:
pnpm exec vitest bench --run tests/bench --compare tests/bench/baseline/local.json
```

`tests/bench/baseline/` is git-ignored (see repo `.gitignore`). In CI, capture the JSON as a build
artifact for trend tracking rather than gating on absolute numbers first.

## Tuning the fixture

`buildLargeManuscript({ sectionCount, wordsPerSection, characterCount, worldCount, seed })` —
defaults give 60 × 2000 ≈ **120k words**, 24 characters, 8 worlds. Bump `wordsPerSection` to model a
worst-case epic; keep `seed` fixed unless you intentionally want a different (still deterministic)
corpus.
