/**
 * Tests for features/lora/loraSlice.ts
 * QNBS-v3: State machine transitions for the LoRA fine-tuning module.
 */

import { describe, expect, it } from 'vitest';
import loraReducer, {
  adapterDeleted,
  adaptersLoaded,
  datasetBuilt,
  evaluationCompleted,
  hydrateLoraState,
  setActiveAdapter,
  setIsBuilding,
  trainingAborted,
  trainingCompleted,
  trainingFailed,
  trainingProgress,
  trainingStarted,
} from '../../../features/lora/loraSlice';
import type { LoraAdapter } from '../../../features/lora/types';

const initial = loraReducer(undefined, { type: '@@INIT' });

const mockAdapter: LoraAdapter = {
  id: 'a1',
  name: 'Test Adapter',
  description: 'test',
  modelCompatibility: 'llama-3.2-7b',
  scale: 1.0,
  fileSizeBytes: 1024,
  createdAt: 1716000000000,
  status: 'idle',
};

describe('loraSlice — initial state', () => {
  it('has correct defaults', () => {
    expect(initial.adapters).toEqual([]);
    expect(initial.activeAdapterId).toBeNull();
    expect(initial.currentRun).toBeNull();
    expect(initial.isBuilding).toBe(false);
    expect(initial.error).toBeNull();
  });
});

describe('loraSlice — adapter management', () => {
  it('adaptersLoaded populates list and detects active', () => {
    const active = { ...mockAdapter, isActive: true };
    const state = loraReducer(initial, adaptersLoaded([mockAdapter, active]));
    expect(state.adapters).toHaveLength(2);
    expect(state.activeAdapterId).toBe(active.id);
  });

  it('setActiveAdapter marks correct adapter and clears others', () => {
    const s0 = loraReducer(initial, adaptersLoaded([mockAdapter, { ...mockAdapter, id: 'a2' }]));
    const s1 = loraReducer(s0, setActiveAdapter('a1'));
    expect(s1.activeAdapterId).toBe('a1');
    expect(s1.adapters.find((a) => a.id === 'a1')?.isActive).toBe(true);
    expect(s1.adapters.find((a) => a.id === 'a2')?.isActive).toBe(false);
  });

  it('adapterDeleted removes adapter and clears activeAdapterId', () => {
    const s0 = loraReducer(initial, adaptersLoaded([mockAdapter]));
    const s1 = loraReducer(s0, setActiveAdapter('a1'));
    const s2 = loraReducer(s1, adapterDeleted('a1'));
    expect(s2.adapters).toHaveLength(0);
    expect(s2.activeAdapterId).toBeNull();
  });
});

describe('loraSlice — training state machine', () => {
  const runPayload = {
    id: 'run-1',
    projectId: 'proj-1',
    baseModelId: 'llama-3.2-7b',
    presetId: 'writer-style-light',
    totalEpochs: 1,
  };

  it('trainingStarted creates a run with status=training', () => {
    const state = loraReducer(initial, trainingStarted(runPayload));
    expect(state.currentRun).not.toBeNull();
    expect(state.currentRun?.status).toBe('training');
    expect(state.currentRun?.progressPercent).toBe(0);
    expect(state.error).toBeNull();
  });

  it('trainingProgress updates metrics on currentRun', () => {
    const s0 = loraReducer(initial, trainingStarted(runPayload));
    const s1 = loraReducer(
      s0,
      trainingProgress({ progressPercent: 42, currentEpoch: 1, currentLoss: 0.85 }),
    );
    expect(s1.currentRun?.progressPercent).toBe(42);
    expect(s1.currentRun?.currentLoss).toBe(0.85);
    expect(s1.currentRun?.lossHistory).toContain(0.85);
  });

  it('trainingCompleted sets 100% and moves to runHistory', () => {
    const s0 = loraReducer(initial, trainingStarted(runPayload));
    const s1 = loraReducer(s0, trainingCompleted({ outputAdapterId: 'adapter-out' }));
    expect(s1.currentRun).toBeNull();
    expect(s1.runHistory).toHaveLength(1);
    expect(s1.runHistory[0]!.status).toBe('completed');
    expect(s1.runHistory[0]!.outputAdapterId).toBe('adapter-out');
  });

  it('trainingFailed records error and moves to runHistory', () => {
    const s0 = loraReducer(initial, trainingStarted(runPayload));
    const s1 = loraReducer(s0, trainingFailed('Python not found'));
    expect(s1.currentRun).toBeNull();
    expect(s1.runHistory[0]!.status).toBe('failed');
    expect(s1.error).toBe('Python not found');
  });

  it('trainingAborted moves run to history with status=aborted', () => {
    const s0 = loraReducer(initial, trainingStarted(runPayload));
    const s1 = loraReducer(s0, trainingAborted());
    expect(s1.currentRun).toBeNull();
    expect(s1.runHistory[0]!.status).toBe('aborted');
  });
});

describe('loraSlice — dataset', () => {
  it('datasetBuilt stores entries and clears isBuilding', () => {
    const s0 = loraReducer(initial, setIsBuilding(true));
    const s1 = loraReducer(
      s0,
      datasetBuilt({
        projectId: 'p1',
        entries: [
          {
            id: 'e1',
            projectId: 'p1',
            instruction: 'test',
            input: '',
            output: 'text',
            source: 'extracted',
            qualityScore: 0.8,
            wordCount: 5,
            createdAt: Date.now(),
          },
        ],
      }),
    );
    expect(s1.datasets['p1']).toHaveLength(1);
    expect(s1.isBuilding).toBe(false);
  });
});

describe('loraSlice — evaluation', () => {
  it('evaluationCompleted stores report and clears isEvaluating', () => {
    const report = { score: 0.82, baseline: 0.65, improvement: 0.17, sampleComparisons: [] };
    const state = loraReducer(initial, evaluationCompleted(report));
    expect(state.lastEvaluation?.score).toBe(0.82);
    expect(state.isEvaluating).toBe(false);
  });
});

describe('loraSlice — hydration', () => {
  it('hydrateLoraState merges persisted data', () => {
    const state = loraReducer(
      initial,
      hydrateLoraState({ activeAdapterId: 'x', selectedPresetId: 'deep-narrative' }),
    );
    expect(state.activeAdapterId).toBe('x');
    expect(state.selectedPresetId).toBe('deep-narrative');
  });
});
