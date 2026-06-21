/**
 * Tests for services/proForge/proForgeCapabilityCore.ts — the pure, IO-free operations of the
 * ProForge Core Capability Layer (the hexagonal seam shared by the browser + Node/MCP adapters).
 * QNBS-v3: no Redux / IDB / browser globals — pure functions only.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PIPELINE_CONFIG,
  type PipelineRun,
  type ReviewItem,
  type StageResult,
} from '../../../features/proForge/types';
import {
  applyEditsPure,
  buildAgentContext,
  type ProForgeProjectSnapshot,
  resolveConfig,
  selectRun,
  supervisorStatusFromRun,
} from '../../../services/proForge/proForgeCapabilityCore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStage(stage: StageResult['stage'], status: StageResult['status']): StageResult {
  const passed = status === 'accepted';
  return {
    stage,
    status,
    reviewItems: [],
    metrics: {} as StageResult['metrics'],
    supervisorDecision: {
      pass: passed,
      retryRecommended: false,
      qualityScore: passed ? 80 : 0,
      reasons: [],
    },
  };
}

function makeRun(id: string, stages: StageResult[] = []): PipelineRun {
  return {
    id,
    projectId: 'p1',
    label: `Run ${id}`,
    config: DEFAULT_PIPELINE_CONFIG,
    status: 'completed',
    activeStage: 'analytics',
    stages,
    startedAt: '2026-01-01T00:00:00Z',
    prePipelineSnapshotId: '',
    traceLog: [],
  };
}

const snapshot: ProForgeProjectSnapshot = {
  id: 'p1',
  title: 'Novel',
  logline: 'A hero rises.',
  manuscript: [{ id: 's1', title: 'Ch 1', content: 'Once upon a time.' }],
  characters: [{ id: 'c1', name: 'Alice' }],
  worlds: [{ id: 'w1', name: 'Westeros' }],
};

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------
describe('resolveConfig', () => {
  it('returns the defaults when no overrides are given', () => {
    expect(resolveConfig()).toEqual(DEFAULT_PIPELINE_CONFIG);
  });

  it('applies provided overrides over the defaults', () => {
    const cfg = resolveConfig({ maxTokens: 5000, creativity: 'Imaginative' });
    expect(cfg.maxTokens).toBe(5000);
    expect(cfg.creativity).toBe('Imaginative');
    expect(cfg.genrePreset).toBe(DEFAULT_PIPELINE_CONFIG.genrePreset); // untouched default
  });

  it('strips undefined values so a partial never clobbers a required default', () => {
    const cfg = resolveConfig({ genrePreset: undefined, maxTokens: undefined });
    expect(cfg.genrePreset).toBe(DEFAULT_PIPELINE_CONFIG.genrePreset);
    expect(cfg.maxTokens).toBe(DEFAULT_PIPELINE_CONFIG.maxTokens);
  });
});

// ---------------------------------------------------------------------------
// selectRun
// ---------------------------------------------------------------------------
describe('selectRun', () => {
  const r1 = makeRun('r1');
  const r2 = makeRun('r2');

  it('returns the run matching the given id', () => {
    expect(selectRun([r1, r2], 'r2')).toBe(r2);
  });

  it('returns the most recent run (index 0) when no id is given', () => {
    expect(selectRun([r1, r2])).toBe(r1);
  });

  it('returns null for an unknown id', () => {
    expect(selectRun([r1, r2], 'nope')).toBeNull();
  });

  it('returns null for an empty history', () => {
    expect(selectRun([])).toBeNull();
    expect(selectRun([], 'r1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// supervisorStatusFromRun
// ---------------------------------------------------------------------------
describe('supervisorStatusFromRun', () => {
  it('maps each stage to its recorded supervisor decision + status (no AI)', () => {
    const run = makeRun('r1', [makeStage('intake', 'accepted'), makeStage('structural', 'failed')]);
    const status = supervisorStatusFromRun(run);
    expect(status).toHaveLength(2);
    expect(status[0]).toMatchObject({ stage: 'intake', status: 'accepted' });
    expect(status[0]?.supervisorDecision?.qualityScore).toBe(80);
    expect(status[1]).toMatchObject({ stage: 'structural', status: 'failed' });
    expect(status[1]?.supervisorDecision?.qualityScore).toBe(0);
  });

  it('emits a null decision when a stage has none recorded', () => {
    const bare: StageResult = {
      stage: 'proof',
      status: 'pending',
      reviewItems: [],
      metrics: {} as StageResult['metrics'],
    };
    const status = supervisorStatusFromRun(makeRun('r1', [bare]));
    expect(status[0]?.supervisorDecision).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyEditsPure
// ---------------------------------------------------------------------------
describe('applyEditsPure', () => {
  it('reports zero changes for an empty review-item set', () => {
    const res = applyEditsPure(snapshot.manuscript, [], true);
    expect(res).toMatchObject({ applied: 0, skipped: 0, invalid: 0, dryRun: true });
    expect(res.updates).toEqual([]);
  });

  it('threads the dryRun flag through to the summary', () => {
    expect(applyEditsPure(snapshot.manuscript, [], false).dryRun).toBe(false);
  });

  it('ignores an advisory review item that carries no proposed replacement', () => {
    // QNBS-v3: only items with a `proposed` are text edits; advisory items are ignored and NOT
    // counted as skipped (status filtering happens upstream of applyEditsPure).
    const advisory: ReviewItem = {
      id: 'ri1',
      stage: 'structural',
      type: 'arcIssue',
      severity: 'warning',
      sectionId: 's1',
      description: 'consider raising the stakes earlier',
      confidence: 0.7,
      status: 'accepted',
      createdAt: '2026-01-01T00:00:00Z',
      // no `proposed` → advisory, not an edit
    };
    const res = applyEditsPure(snapshot.manuscript, [advisory], true);
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(0);
  });

  it('applies an accepted edit whose original text anchors in the section', () => {
    const edit: ReviewItem = {
      id: 'ri2',
      stage: 'lineProse',
      type: 'proseEdit',
      severity: 'info',
      sectionId: 's1',
      range: { start: 0, end: 4 },
      description: 'tighten the opening',
      original: 'Once',
      proposed: 'Then',
      confidence: 0.9,
      status: 'accepted',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const res = applyEditsPure(snapshot.manuscript, [edit], false);
    expect(res.applied).toBe(1);
    expect(res.updates[0]).toMatchObject({ id: 's1' });
    expect(res.updates[0]?.content).toContain('Then');
  });
});

// ---------------------------------------------------------------------------
// buildAgentContext
// ---------------------------------------------------------------------------
describe('buildAgentContext', () => {
  it('builds an orchestrator context with a no-op dispatch and synthetic state', () => {
    const gateway = { generate: vi.fn() } as unknown as Parameters<typeof buildAgentContext>[2];
    const ctx = buildAgentContext(snapshot, DEFAULT_PIPELINE_CONFIG, gateway);
    expect(ctx.projectId).toBe('p1');
    expect(ctx.manuscript).toEqual(snapshot.manuscript);
    expect(ctx.characters).toEqual(snapshot.characters);
    expect(ctx.worlds).toEqual(snapshot.worlds);
    expect(ctx.config).toBe(DEFAULT_PIPELINE_CONFIG);
    expect(ctx.gateway).toBe(gateway);
    // dispatch is a no-op (single-stage runs never touch Redux)
    expect(ctx.dispatch({ type: 'noop' } as never)).toBeUndefined();
    // getState exposes a ProjectData-compatible snapshot under project.present.data
    const state = ctx.getState() as unknown as {
      project: { present: { data: ProForgeProjectSnapshot } };
    };
    expect(state.project.present.data.title).toBe('Novel');
  });
});
