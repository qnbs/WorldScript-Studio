import { describe, expect, it, vi } from 'vitest';
import { createActor, fromPromise, waitFor } from 'xstate';
import { proForgeMachine } from '../../features/proForge/machine/proForgeMachine';
import type {
  ApplyEditsInput,
  ExecutablePipelineStage,
  RunStageInput,
  SnapshotInput,
  StageAgentResult,
  SuperviseInput,
} from '../../features/proForge/machine/proForgeMachine.types';
import type { SupervisionDecision } from '../../features/proForge/types';

// QNBS-v3: Headless machine tests — no React, no live store. Actors are injected via .provide so we
// assert the control flow (snapshot → run → supervise gate → review → apply → advance, plus retry,
// intake hard-fail, abort, rollback) deterministically, mirroring proForgeOrchestrator's behavior.

const EMPTY_METRICS = {
  aiCalls: 0,
  tokensConsumed: 0,
  durationMs: 0,
  itemsFound: 0,
  itemsAccepted: 0,
  itemsRejected: 0,
};

const result = (): StageAgentResult => ({
  reviewItems: [],
  metrics: EMPTY_METRICS,
  agentOutput: {},
});

const PASS: SupervisionDecision = {
  pass: true,
  retryRecommended: false,
  qualityScore: 100,
  reasons: [],
};

interface Overrides {
  supervise?: (input: SuperviseInput) => Promise<SupervisionDecision>;
  runStage?: (input: RunStageInput) => Promise<StageAgentResult>;
  applyEdits?: (input: ApplyEditsInput) => Promise<{ applied: number }>;
  restore?: (input: { snapshotId: string | null }) => void;
}

function makeActor(
  selectedStages: ExecutablePipelineStage[],
  opts: { maxRetries?: 0 | 1; overrides?: Overrides } = {},
) {
  const machine = proForgeMachine.provide({
    actors: {
      snapshot: fromPromise<string, SnapshotInput>(async () => 'snap'),
      runStage: fromPromise<StageAgentResult, RunStageInput>(
        async ({ input }) => opts.overrides?.runStage?.(input) ?? result(),
      ),
      supervise: fromPromise<SupervisionDecision, SuperviseInput>(
        async ({ input }) => opts.overrides?.supervise?.(input) ?? PASS,
      ),
      applyEdits: fromPromise<{ applied: number }, ApplyEditsInput>(
        async ({ input }) => opts.overrides?.applyEdits?.(input) ?? { applied: 0 },
      ),
      restore: fromPromise<void, { snapshotId: string | null }>(async ({ input }) => {
        opts.overrides?.restore?.(input);
      }),
    },
  });
  return createActor(machine, {
    input: {
      projectId: 'p1',
      label: 'Run',
      selectedStages,
      // QNBS-v3: omit maxRetries entirely when not given (exactOptionalPropertyTypes) so the machine's
      // own default (1) is exercised.
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    },
  });
}

describe('proForgeMachine', () => {
  it('runs a two-stage pipeline to completion through human review', async () => {
    const actor = makeActor(['intake', 'structural']);
    actor.start();
    actor.send({ type: 'START' });

    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    expect(actor.getSnapshot().context.currentStage).toBe('intake');

    actor.send({ type: 'SUBMIT_REVIEW', decisions: [] });
    await waitFor(
      actor,
      (s) => s.matches({ running: 'awaitingReview' }) && s.context.currentStage === 'structural',
    );

    actor.send({ type: 'SUBMIT_REVIEW', decisions: [] });
    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('completed');
  });

  it('retries a stage once when the supervisor fails it, then proceeds', async () => {
    let calls = 0;
    const actor = makeActor(['intake'], {
      maxRetries: 1,
      overrides: {
        supervise: async () => {
          calls += 1;
          return calls === 1
            ? { pass: false, retryRecommended: true, qualityScore: 80, reasons: ['weak'] }
            : PASS;
        },
      },
    });
    actor.start();
    actor.send({ type: 'START' });

    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    expect(calls).toBe(2);
    expect(actor.getSnapshot().context.attempt).toBe(1);
  });

  it('hard-fails when intake quality is below the gate and no retry is allowed', async () => {
    const actor = makeActor(['intake'], {
      maxRetries: 0,
      overrides: {
        supervise: async () => ({
          pass: false,
          retryRecommended: false,
          qualityScore: 10,
          reasons: ['unanalyzable'],
        }),
      },
    });
    actor.start();
    actor.send({ type: 'START' });

    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().context.error).toMatch(/diagnostic/i);
  });

  it('skips edit application for non-editing stages', async () => {
    const applyEdits = vi.fn(async () => ({ applied: 0 }));
    const actor = makeActor(['analytics'], { overrides: { applyEdits } });
    actor.start();
    actor.send({ type: 'START' });

    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    actor.send({ type: 'SUBMIT_REVIEW', decisions: [] });
    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('completed');
    expect(applyEdits).not.toHaveBeenCalled();
  });

  it('aborts from review into the aborted final state', async () => {
    const actor = makeActor(['intake', 'structural']);
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));

    actor.send({ type: 'ABORT' });
    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('aborted');
  });

  it('rolls back to an earlier stage and re-enters its review', async () => {
    const actor = makeActor(['intake', 'structural']);
    actor.start();
    actor.send({ type: 'START' });

    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    actor.send({ type: 'SUBMIT_REVIEW', decisions: [] });
    await waitFor(
      actor,
      (s) => s.matches({ running: 'awaitingReview' }) && s.context.currentStage === 'structural',
    );

    actor.send({ type: 'ROLLBACK', stage: 'intake' });
    await waitFor(
      actor,
      (s) => s.matches({ running: 'awaitingReview' }) && s.context.currentStage === 'intake',
    );
    expect(actor.getSnapshot().context.stageIndex).toBe(0);
  });

  it('feeds supervisor reasons AND the agent reflection note into the retry prompt', async () => {
    const feedbacks: string[] = [];
    let supCalls = 0;
    const actor = makeActor(['structural'], {
      maxRetries: 1,
      overrides: {
        runStage: async (input) => {
          feedbacks.push(input.retryFeedback);
          return {
            reviewItems: [],
            metrics: EMPTY_METRICS,
            agentOutput: { reflectionNotes: 'tighten the prose' },
          };
        },
        supervise: async () => {
          supCalls += 1;
          return supCalls === 1
            ? { pass: false, retryRecommended: true, qualityScore: 70, reasons: ['weak structure'] }
            : PASS;
        },
      },
    });
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    // The 2nd run carries retry feedback built from the supervisor reasons + the reflection note.
    expect(feedbacks[1]).toContain('weak structure');
    expect(feedbacks[1]).toContain('tighten the prose');
  });

  it('ignores a ROLLBACK to a stage outside the selected pipeline (guard)', async () => {
    const actor = makeActor(['intake', 'structural']);
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    // 'lineProse' was never selected — the guard rejects it; state stays consistent.
    actor.send({ type: 'ROLLBACK', stage: 'lineProse' });
    expect(actor.getSnapshot().matches({ running: 'awaitingReview' })).toBe(true);
    expect(actor.getSnapshot().context.currentStage).toBe('intake');
    expect(actor.getSnapshot().context.stageIndex).toBe(0);
  });

  it('accepts ABORT while preparing (before the pipeline runs)', () => {
    const actor = makeActor(['intake']);
    actor.start();
    actor.send({ type: 'START' });
    // The snapshot actor resolves on a later microtask, so we are synchronously still in `preparing`.
    expect(actor.getSnapshot().value).toBe('preparing');
    actor.send({ type: 'ABORT' });
    expect(actor.getSnapshot().value).toBe('aborting');
  });

  it('completes immediately when no stages are selected (never runs a default stage)', async () => {
    const runStage = vi.fn(async () => result());
    const actor = makeActor([], { overrides: { runStage } });
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.status === 'done');
    expect(actor.getSnapshot().value).toBe('completed');
    expect(runStage).not.toHaveBeenCalled();
  });

  it('restores the target stage snapshot on ROLLBACK before re-running it', async () => {
    const restored: Array<string | null> = [];
    const actor = makeActor(['intake', 'structural'], {
      overrides: { restore: ({ snapshotId }) => restored.push(snapshotId) },
    });
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    actor.send({ type: 'SUBMIT_REVIEW', decisions: [] });
    await waitFor(
      actor,
      (s) => s.matches({ running: 'awaitingReview' }) && s.context.currentStage === 'structural',
    );
    actor.send({ type: 'ROLLBACK', stage: 'intake' });
    await waitFor(
      actor,
      (s) => s.matches({ running: 'awaitingReview' }) && s.context.currentStage === 'intake',
    );
    // The restore actor ran with intake's captured snapshot id (every snapshot actor returns 'snap').
    expect(restored).toContain('snap');
  });

  it('ignores a ROLLBACK to a later stage that has not run yet (no forward jump)', async () => {
    const actor = makeActor(['intake', 'structural']);
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    // We are on intake (index 0); 'structural' (index 1) is ahead — the guard must reject it.
    actor.send({ type: 'ROLLBACK', stage: 'structural' });
    expect(actor.getSnapshot().matches({ running: 'awaitingReview' })).toBe(true);
    expect(actor.getSnapshot().context.currentStage).toBe('intake');
    expect(actor.getSnapshot().context.stageIndex).toBe(0);
  });

  it('defaults maxRetries to 1 when omitted so supervisor retries still fire', async () => {
    let calls = 0;
    // No maxRetries passed — the machine must default to 1, not disable retries.
    const actor = makeActor(['intake'], {
      overrides: {
        supervise: async () => {
          calls += 1;
          return calls === 1
            ? { pass: false, retryRecommended: true, qualityScore: 80, reasons: ['weak'] }
            : PASS;
        },
      },
    });
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
    expect(calls).toBe(2);
    expect(actor.getSnapshot().context.attempt).toBe(1);
  });
});
