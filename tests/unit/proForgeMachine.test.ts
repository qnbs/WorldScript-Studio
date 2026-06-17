import { describe, expect, it, vi } from 'vitest';
import { createActor, fromPromise, waitFor } from 'xstate';
import { proForgeMachine } from '../../features/proForge/machine/proForgeMachine';
import type {
  ApplyEditsInput,
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
}

function makeActor(
  selectedStages: string[],
  opts: { maxRetries?: number; overrides?: Overrides } = {},
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
      restore: fromPromise<void, { snapshotId: string | null }>(async () => {}),
    },
  });
  return createActor(machine, {
    input: {
      projectId: 'p1',
      label: 'Run',
      // biome-ignore lint/suspicious/noExplicitAny: test passes stage strings directly
      selectedStages: selectedStages as any,
      maxRetries: opts.maxRetries ?? 1,
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
});
