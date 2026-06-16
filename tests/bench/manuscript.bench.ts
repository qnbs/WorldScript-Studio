// tests/bench/manuscript.bench.ts
//
// QNBS-v3: A0.1 — Large-manuscript performance harness (ROADMAP Phase 0 / strategic plan §4, §8).
// Establishes the baseline the Local-First (Y.Doc-as-SoT) migration is judged against. Each bench
// exercises a main-thread hot path against a deterministic ~120k-word fixture:
//   • typing      — updateManuscriptSection content edit through the redux-undo wrapper (immer
//                   produce over the full project + 100-deep history snapshot)
//   • undo        — ActionCreators.undo() from a full history
//   • save-json   — JSON.stringify of the whole project (proxy for the IDB persist payload)
//   • snapshot    — structuredClone of the project (proxy for per-keystroke snapshot memory cost)
//   • word-count  — full-manuscript word recompute (analytics / progress-tracker path)
//   • proforge    — intake text assembly the ProForge proof/diagnostic agents do before any AI call
//
// Run: pnpm bench   (see tests/bench/README.md for how to record/compare baselines)
// Low-end-hardware note: bench `time` budgets are intentionally small; run as ONE process.

import type { AnyAction } from '@reduxjs/toolkit';
import undoable, { ActionCreators, type StateWithHistory } from 'redux-undo';
import { bench, describe } from 'vitest';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import type { ProjectData } from '../../features/project/projectState';
import { buildLargeManuscript, totalWordCount } from './fixtures/largeManuscript';

// --- Mirror the live store's undo configuration (app/store.ts) so the measured cost is faithful. ---
const filterUndoableActions = (action: AnyAction): boolean =>
  !['/pending', '/fulfilled', '/rejected'].some((suffix) => action.type.endsWith(suffix));

interface ProjectSliceState {
  data: ProjectData;
}
type UndoableProjectState = StateWithHistory<ProjectSliceState>;

const undoableProjectReducer = undoable(projectReducer, {
  limit: 100,
  filter: filterUndoableActions,
});

// --- Deterministic fixture: built once, shared across all benches. ---
const fixture = buildLargeManuscript();
const FIRST_SECTION_ID = fixture.manuscript[0]?.id ?? 'sec-0';

/** Seed a valid redux-undo state whose `present` is the large fixture (skeleton from a real init). */
function seedUndoableState(project: ProjectData): UndoableProjectState {
  const skeleton = undoableProjectReducer(undefined, { type: '@@INIT' });
  const present: ProjectSliceState = { data: project };
  return { ...skeleton, present, _latestUnfiltered: present };
}

/** A content edit on the first section — the real typing hot path (immer produce over the manuscript). */
// QNBS-v3 (CodeAnt): the edit payload must be CONSTANT-SIZE so timing stays comparable across
// iterations. Toggle a single fixed-length suffix (' A' ⇄ ' B') so the content still changes every
// call (immer registers a diff) without the payload growing over the run.
const BASE_CONTENT = fixture.manuscript[0]?.content ?? '';
let editToggle = false;
function editAction(): AnyAction {
  editToggle = !editToggle;
  return projectActions.updateManuscriptSection({
    id: FIRST_SECTION_ID,
    changes: { content: `${BASE_CONTENT} ${editToggle ? 'A' : 'B'}` },
  });
}

// A "warm" state with a full (100-deep) undo history — steady-state typing, not first keystroke.
const warmState: UndoableProjectState = (() => {
  let state = seedUndoableState(fixture);
  for (let i = 0; i < 100; i++) {
    state = undoableProjectReducer(state, editAction());
  }
  return state;
})();

const BENCH_OPTS = { time: 250, warmupTime: 100, warmupIterations: 3 } as const;

describe('large manuscript (~120k words) — main-thread hot paths', () => {
  // Each iteration is independent: it starts from the same warm (history-full) state and applies one
  // edit. This isolates the per-keystroke cost (immer produce + redux-undo past push, capped at 100).
  bench(
    'typing: updateManuscriptSection through redux-undo (steady state)',
    () => {
      undoableProjectReducer(warmState, editAction());
    },
    BENCH_OPTS,
  );

  bench(
    'undo: ActionCreators.undo() from full history',
    () => {
      undoableProjectReducer(warmState, ActionCreators.undo());
    },
    BENCH_OPTS,
  );

  bench(
    'save: JSON.stringify(project) — IDB persist payload',
    () => {
      JSON.stringify(fixture);
    },
    BENCH_OPTS,
  );

  bench(
    'snapshot: structuredClone(project) — per-keystroke snapshot cost',
    () => {
      structuredClone(fixture);
    },
    BENCH_OPTS,
  );

  bench(
    'analytics: full-manuscript word count',
    () => {
      totalWordCount(fixture);
    },
    BENCH_OPTS,
  );

  bench(
    'proforge: intake text assembly (no AI)',
    () => {
      // Mirrors services/proForge/pipelineAgents/proofAgent.ts intake assembly.
      fixture.manuscript.map((s) => `### ${s.title}\n${s.content ?? ''}`).join('\n\n');
    },
    BENCH_OPTS,
  );
});
