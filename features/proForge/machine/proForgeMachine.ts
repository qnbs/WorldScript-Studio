// QNBS-v3: ProForge pipeline as an XState v5 machine (P4). Formalizes the states the type system
// already enumerates (StageStatus / PipelineRunStatus) and that proForgeOrchestrator.ts implements
// imperatively — per-stage snapshot, agent run, supervisor gate (retry / intake hard-fail), human
// review, edit application, advance — plus rollback and abort. Side effects live in injectable
// actors (default no-op implementations here; the integration hook wires real services + Redux in
// P4b), so the control flow is unit-testable headless without a live store.
import { assign, fromPromise, setup } from 'xstate';
import { EDITING_STAGES } from '../types';
import type {
  ApplyEditsInput,
  ProForgeMachineContext,
  ProForgeMachineEvent,
  ProForgeMachineInput,
  RunStageInput,
  SnapshotInput,
  StageAgentResult,
  SuperviseInput,
} from './proForgeMachine.types';

const EMPTY_METRICS = {
  aiCalls: 0,
  tokensConsumed: 0,
  durationMs: 0,
  itemsFound: 0,
  itemsAccepted: 0,
  itemsRejected: 0,
};

const EMPTY_RESULT: StageAgentResult = {
  reviewItems: [],
  metrics: EMPTY_METRICS,
  agentOutput: {},
};

export const proForgeMachine = setup({
  types: {
    context: {} as ProForgeMachineContext,
    events: {} as ProForgeMachineEvent,
    input: {} as ProForgeMachineInput,
  },
  actors: {
    // QNBS-v3: Default actors are inert placeholders — the hook/tests override them via .provide().
    snapshot: fromPromise<string, SnapshotInput>(async () => 'snapshot-id'),
    runStage: fromPromise<StageAgentResult, RunStageInput>(async () => EMPTY_RESULT),
    supervise: fromPromise<
      { pass: boolean; retryRecommended: boolean; qualityScore: number; reasons: string[] },
      SuperviseInput
    >(async () => ({ pass: true, retryRecommended: false, qualityScore: 100, reasons: [] })),
    applyEdits: fromPromise<{ applied: number }, ApplyEditsInput>(async () => ({ applied: 0 })),
    restore: fromPromise<void, { snapshotId: string | null }>(async () => {}),
  },
  guards: {
    canRetry: ({ context }) =>
      context.lastDecision != null &&
      !context.lastDecision.pass &&
      context.attempt < context.maxRetries,
    intakeHardFail: ({ context }) =>
      context.currentStage === 'intake' && (context.lastDecision?.qualityScore ?? 0) < 30,
    hasNextStage: ({ context }) => context.stageIndex + 1 < context.selectedStages.length,
    isEditingStage: ({ context }) => EDITING_STAGES.includes(context.currentStage),
    // QNBS-v3: never start a run with no selected stages — defaulting currentStage to 'intake' would
    // otherwise execute a stage the user never selected (the orchestrator doesn't run in that case).
    hasStages: ({ context }) => context.selectedStages.length > 0,
    // QNBS-v3: rollback may only target an EARLIER (or current) selected stage — a target that is in
    // selectedStages but ahead of stageIndex would be an invalid forward jump, breaking rollback
    // semantics (and re-running a stage that never ran).
    canRollback: ({ context, event }) =>
      event.type === 'ROLLBACK' &&
      context.selectedStages.includes(event.stage) &&
      context.selectedStages.indexOf(event.stage) <= context.stageIndex,
  },
  actions: {
    // QNBS-v3: cast through `unknown` — these onDone actions only ever fire on the invoke's
    // done event (which carries `output`), but the ProForgeMachineEvent union also includes
    // ABORT (no `output`), so a direct cast no longer overlaps (TS2352).
    setPreSnapshot: assign({
      prePipelineSnapshotId: ({ event }) => (event as unknown as { output: string }).output,
    }),
    // QNBS-v3: record each stage's pre-run snapshot id keyed by stageIndex so ROLLBACK can restore
    // the exact checkpoint of its target stage (deterministic rollback restore).
    setStageSnapshot: assign({
      stageSnapshots: ({ context, event }) => ({
        ...context.stageSnapshots,
        [context.stageIndex]: (event as unknown as { output: string }).output,
      }),
    }),
    setResult: assign({
      lastResult: ({ event }) => (event as unknown as { output: StageAgentResult }).output,
    }),
    setDecision: assign({
      lastDecision: ({ event }) =>
        (event as unknown as { output: ProForgeMachineContext['lastDecision'] }).output,
    }),
    setRunError: assign({
      error: ({ event }) => {
        const err = (event as { error?: unknown }).error;
        return err instanceof Error ? err.message : String(err ?? 'Stage failed');
      },
    }),
    setIntakeHardFailError: assign({
      error: () =>
        "The diagnostic couldn't analyze your manuscript. Check your AI provider connection and try again.",
    }),
    incrementAttempt: assign({
      attempt: ({ context }) => context.attempt + 1,
      // QNBS-v3: parity with proForgeOrchestrator — feed supervisor reasons AND the agent's
      // self-reflection note from the last result into the next attempt's prompt.
      retryFeedback: ({ context }) => {
        const reflectionNote = (
          context.lastResult?.agentOutput as { reflectionNotes?: string } | undefined
        )?.reflectionNotes;
        return [...(context.lastDecision?.reasons ?? []), reflectionNote]
          .filter((line): line is string => Boolean(line))
          .map((line) => `- ${line}`)
          .join('\n');
      },
    }),
    setReviewDecisions: assign({
      reviewDecisions: ({ event }) => (event.type === 'SUBMIT_REVIEW' ? event.decisions : null),
    }),
    applyRollback: assign({
      currentStage: ({ context, event }) =>
        event.type === 'ROLLBACK' ? event.stage : context.currentStage,
      stageIndex: ({ context, event }) =>
        event.type === 'ROLLBACK'
          ? Math.max(0, context.selectedStages.indexOf(event.stage))
          : context.stageIndex,
      attempt: () => 0,
      retryFeedback: () => '',
    }),
    advanceStage: assign({
      stageIndex: ({ context }) => context.stageIndex + 1,
      currentStage: ({ context }) =>
        context.selectedStages[context.stageIndex + 1] ?? context.currentStage,
      attempt: () => 0,
      retryFeedback: () => '',
      lastResult: () => null,
      lastDecision: () => null,
      reviewDecisions: () => null,
    }),
  },
}).createMachine({
  id: 'proforge',
  initial: 'idle',
  context: ({ input }) => ({
    projectId: input.projectId,
    label: input.label,
    selectedStages: input.selectedStages,
    stageIndex: 0,
    currentStage: input.selectedStages[0] ?? 'intake',
    attempt: 0,
    // QNBS-v3: clamp to {0,1} (mirrors proForgeOrchestrator's `config.maxRetries ?? 1`). Only an
    // explicit 0 disables retries; undefined or any out-of-contract value (a huge number / Infinity
    // from tampered persisted config) collapses to 1, so it can never drive runaway stage re-execution.
    maxRetries: input.maxRetries === 0 ? 0 : 1,
    retryFeedback: '',
    lastResult: null,
    lastDecision: null,
    reviewDecisions: null,
    prePipelineSnapshotId: null,
    stageSnapshots: {},
    error: null,
  }),
  states: {
    idle: {
      on: {
        // QNBS-v3: only enter the pipeline when at least one stage is selected; otherwise complete
        // immediately rather than executing an unselected default stage.
        START: [{ guard: 'hasStages', target: 'preparing' }, { target: 'completed' }],
      },
    },
    preparing: {
      // QNBS-v3: accept ABORT while the pre-pipeline snapshot actor runs — otherwise a cancel sent
      // right after START is ignored and the pipeline proceeds anyway.
      on: { ABORT: 'aborting' },
      invoke: {
        src: 'snapshot',
        input: ({ context }) => ({ stage: 'prePipeline' as const, label: context.label }),
        onDone: { target: 'running', actions: 'setPreSnapshot' },
        // QNBS-v3: snapshot failure is non-fatal — proceed without a pre-pipeline restore point.
        onError: 'running',
      },
    },
    running: {
      initial: 'preStageSnapshot',
      // QNBS-v3: ABORT is accepted from any running substate; leaving cancels the invoked actor.
      on: { ABORT: 'aborting' },
      states: {
        preStageSnapshot: {
          invoke: {
            src: 'snapshot',
            input: ({ context }) => ({ stage: context.currentStage, label: context.label }),
            // QNBS-v3: capture the snapshot id (keyed by stageIndex) so ROLLBACK can restore it.
            onDone: { target: 'executingStage', actions: 'setStageSnapshot' },
            onError: 'executingStage',
          },
        },
        rollingBack: {
          // QNBS-v3: restore the target stage's captured snapshot before re-running it, so rollback
          // is a true checkpoint restore (not just a counter rewind). applyRollback already moved
          // stageIndex to the target, so stageSnapshots[stageIndex] is the right checkpoint.
          invoke: {
            src: 'restore',
            input: ({ context }) => ({
              snapshotId: context.stageSnapshots[context.stageIndex] ?? null,
            }),
            onDone: 'preStageSnapshot',
            onError: 'preStageSnapshot',
          },
        },
        executingStage: {
          invoke: {
            src: 'runStage',
            input: ({ context }) => ({
              stage: context.currentStage,
              retryFeedback: context.retryFeedback,
            }),
            onDone: { target: 'supervising', actions: 'setResult' },
            onError: { target: '#proforge.failed', actions: 'setRunError' },
          },
        },
        supervising: {
          invoke: {
            src: 'supervise',
            input: ({ context }) => ({
              stage: context.currentStage,
              result: context.lastResult ?? EMPTY_RESULT,
            }),
            onDone: { target: 'gate', actions: 'setDecision' },
            // QNBS-v3: supervisor failure shouldn't block the human — fall through to review.
            onError: 'awaitingReview',
          },
        },
        gate: {
          // QNBS-v3: Mirror the orchestrator order — retry while allowed, then intake hard-gate,
          // otherwise hand to the human reviewer.
          always: [
            { guard: 'canRetry', target: 'retrying' },
            {
              guard: 'intakeHardFail',
              target: '#proforge.failed',
              actions: 'setIntakeHardFailError',
            },
            { target: 'awaitingReview' },
          ],
        },
        retrying: {
          entry: 'incrementAttempt',
          always: 'executingStage',
        },
        awaitingReview: {
          on: {
            SUBMIT_REVIEW: [
              {
                guard: 'isEditingStage',
                target: 'applyingEdits',
                actions: 'setReviewDecisions',
              },
              { target: 'advancing', actions: 'setReviewDecisions' },
            ],
            SKIP: 'advancing',
            ROLLBACK: {
              guard: 'canRollback',
              target: 'rollingBack',
              actions: 'applyRollback',
            },
          },
        },
        applyingEdits: {
          invoke: {
            src: 'applyEdits',
            input: ({ context }) => ({
              stage: context.currentStage,
              decisions: context.reviewDecisions ?? [],
              result: context.lastResult,
            }),
            // QNBS-v3: edit application is best-effort (stale anchors skipped) — advance either way.
            onDone: 'advancing',
            onError: 'advancing',
          },
        },
        advancing: {
          always: [
            { guard: 'hasNextStage', target: 'preStageSnapshot', actions: 'advanceStage' },
            { target: '#proforge.completed' },
          ],
        },
      },
    },
    aborting: {
      invoke: {
        src: 'restore',
        input: ({ context }) => ({ snapshotId: context.prePipelineSnapshotId }),
        onDone: 'aborted',
        onError: 'aborted',
      },
    },
    completed: { type: 'final' },
    failed: { type: 'final' },
    aborted: { type: 'final' },
  },
});
