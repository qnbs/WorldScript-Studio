/**
 * Tests for features/lora/loraSelectors.ts
 * QNBS-v3: Memoized selector correctness.
 */

import { describe, expect, it } from 'vitest';
import type { RootState } from '../../../app/store';
import {
  selectActiveAdapter,
  selectDatasetForProject,
  selectIsTraining,
  selectLoraAdapters,
  selectSelectedPreset,
} from '../../../features/lora/loraSelectors';
import type { LoraAdapter, LoraState } from '../../../features/lora/types';

const adapter: LoraAdapter = {
  id: 'a1',
  name: 'Test',
  description: '',
  modelCompatibility: 'llama-3.2-7b',
  scale: 1,
  fileSizeBytes: 100,
  createdAt: 1,
  status: 'active',
  isActive: true,
};

function makeState(lora: Partial<LoraState>): { lora: LoraState } {
  return {
    lora: {
      adapters: [],
      activeAdapterId: null,
      currentRun: null,
      runHistory: [],
      datasets: {},
      isBuilding: false,
      isMerging: false,
      isEvaluating: false,
      activeView: 'library',
      wizardStep: 'model',
      selectedPresetId: 'writer-style-light',
      selectedBaseModel: '',
      error: null,
      lastEvaluation: null,
      ...lora,
    },
  } as unknown as { lora: LoraState };
}

describe('selectLoraAdapters', () => {
  it('returns empty array when no adapters', () => {
    expect(selectLoraAdapters(makeState({}) as unknown as RootState)).toEqual([]);
  });

  it('returns adapter list', () => {
    const state = makeState({ adapters: [adapter] });
    expect(selectLoraAdapters(state as unknown as RootState)).toHaveLength(1);
  });
});

describe('selectActiveAdapter', () => {
  it('returns null when no active adapter', () => {
    expect(selectActiveAdapter(makeState({}) as unknown as RootState)).toBeNull();
  });

  it('returns adapter matching activeAdapterId', () => {
    const state = makeState({ adapters: [adapter], activeAdapterId: 'a1' });
    expect(selectActiveAdapter(state as unknown as RootState)?.id).toBe('a1');
  });
});

describe('selectIsTraining', () => {
  it('returns false when no run', () => {
    expect(selectIsTraining(makeState({}) as unknown as RootState)).toBe(false);
  });

  it('returns true when run status is training', () => {
    const state = makeState({
      currentRun: {
        id: 'r1',
        projectId: 'p1',
        baseModelId: 'm',
        presetId: 'x',
        status: 'training',
        progressPercent: 0,
        currentEpoch: 0,
        totalEpochs: 1,
        currentLoss: 0,
        lossHistory: [],
        startedAt: 0,
      },
    });
    expect(selectIsTraining(state as unknown as RootState)).toBe(true);
  });
});

describe('selectSelectedPreset', () => {
  it('returns writer-style-light as default', () => {
    const preset = selectSelectedPreset(makeState({}) as unknown as RootState);
    expect(preset!.id).toBe('writer-style-light');
  });
});

describe('selectDatasetForProject', () => {
  it('returns empty array for unknown project', () => {
    const selector = selectDatasetForProject('unknown');
    expect(selector(makeState({}) as unknown as RootState)).toEqual([]);
  });

  it('returns entries for known project', () => {
    const entry = {
      id: 'e1',
      projectId: 'p1',
      instruction: 'test',
      input: '',
      output: 'text',
      source: 'extracted' as const,
      qualityScore: 0.8,
      wordCount: 5,
      createdAt: 1,
    };
    const state = makeState({ datasets: { p1: [entry] } });
    const selector = selectDatasetForProject('p1');
    expect(selector(state as unknown as RootState)).toHaveLength(1);
  });
});
