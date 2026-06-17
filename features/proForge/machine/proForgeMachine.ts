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
  },
  actions: {
    setPreSnapshot: assign({
      prePipelineSnapshotId: ({ event }) => (event as { output: string }).output,
    }),
    setResult: assign({
      lastResult: ({ event }) => (event as { output: StageAgentResult }).output,
    }),
    setDecision: assign({
      lastDecision: ({ event }) =>
        (event as { output: ProForgeMachineContext['lastDecision'] }).output,
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
      retryFeedback: ({ context }) =>
        (context.lastDecision?.reasons ?? []).map((r) => `- ${r}`).join('\n'),
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
    maxRetries: input.maxRetries,
    retryFeedback: '',
    lastResult: null,
    lastDecision: null,
    reviewDecisions: null,
    prePipelineSnapshotId: null,
    error: null,
  }),
  states: {
    idle: {
      on: { START: 'preparing' },
    },
    preparing: {
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
            onDone: 'executingStage',
            onError: 'executingStage',
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
            ROLLBACK: { target: 'preStageSnapshot', actions: 'applyRollback' },
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
