import { describe, expect, it } from 'vitest';
import {
  computePipelineProgress,
  type PipelineProgress,
} from '../../../features/proForge/pipelineProgress';
import {
  DEFAULT_PIPELINE_CONFIG,
  type PipelineRun,
  type PipelineStage,
  type StageResult,
  type StageStatus,
} from '../../../features/proForge/types';

function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: 'run-1',
    projectId: 'p1',
    label: 'Test',
    config: { ...DEFAULT_PIPELINE_CONFIG, selectedStages: ['intake', 'structural', 'lineProse'] },
    status: 'running',
    activeStage: 'structural',
    stages: [],
    startedAt: new Date(0).toISOString(),
    prePipelineSnapshotId: 'snap-0',
    traceLog: [],
    ...overrides,
  };
}

// Minimal but fully-typed StageResult — only stage + status drive progress.
function stageResult(stage: PipelineStage, status: StageStatus): StageResult {
  return {
    stage,
    status,
    reviewItems: [],
    metrics: {
      aiCalls: 0,
      tokensConsumed: 0,
      durationMs: 0,
      itemsFound: 0,
      itemsAccepted: 0,
      itemsRejected: 0,
    },
  };
}

describe('computePipelineProgress', () => {
  it('returns a zeroed result for a null run', () => {
    expect(computePipelineProgress(null)).toEqual<PipelineProgress>({
      completed: 0,
      total: 0,
      percent: 0,
      activeIndex: 0,
    });
  });

  it('returns zeros when no stages are selected', () => {
    const run = makeRun({ config: { ...DEFAULT_PIPELINE_CONFIG, selectedStages: [] } });
    expect(computePipelineProgress(run)).toEqual<PipelineProgress>({
      completed: 0,
      total: 0,
      percent: 0,
      activeIndex: 0,
    });
  });

  it('counts accepted + skipped stages as completed', () => {
    const run = makeRun({
      stages: [stageResult('intake', 'accepted'), stageResult('structural', 'running')],
    });
    const p = computePipelineProgress(run);
    expect(p.total).toBe(3);
    expect(p.completed).toBe(1);
    expect(p.percent).toBe(33); // round(1/3 * 100)
    expect(p.activeIndex).toBe(2); // 'structural' is 2nd of 3
  });

  it('does not count running / awaitingReview stages as completed', () => {
    const run = makeRun({
      stages: [stageResult('intake', 'awaitingReview'), stageResult('structural', 'running')],
    });
    expect(computePipelineProgress(run).completed).toBe(0);
  });

  it('counts a skipped stage toward completion', () => {
    const run = makeRun({
      stages: [stageResult('intake', 'accepted'), stageResult('structural', 'skipped')],
    });
    const p = computePipelineProgress(run);
    expect(p.completed).toBe(2);
    expect(p.percent).toBe(67); // round(2/3 * 100)
  });

  it('reports 100% when all selected stages are done', () => {
    const run = makeRun({
      activeStage: 'lineProse',
      stages: [
        stageResult('intake', 'accepted'),
        stageResult('structural', 'accepted'),
        stageResult('lineProse', 'accepted'),
      ],
    });
    const p = computePipelineProgress(run);
    expect(p.completed).toBe(3);
    expect(p.percent).toBe(100);
    expect(p.activeIndex).toBe(3);
  });

  it('ignores stage results for stages not in the selected set', () => {
    const run = makeRun({
      stages: [stageResult('intake', 'accepted'), stageResult('proof', 'accepted')], // proof not selected
    });
    expect(computePipelineProgress(run).completed).toBe(1);
  });

  it('returns activeIndex 0 when the active stage is not in the selected set', () => {
    const run = makeRun({ activeStage: 'proof' });
    expect(computePipelineProgress(run).activeIndex).toBe(0);
  });
});
