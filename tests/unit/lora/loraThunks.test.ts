/**
 * Tests for features/lora/loraThunks.ts
 * QNBS-v3: Exercises dispatch sequences for all async thunks with mocked services.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects
// ---------------------------------------------------------------------------

const mockListAdapters = vi.hoisted(() => vi.fn());
const mockActivateAdapter = vi.hoisted(() => vi.fn());
const mockDeactivateAdapter = vi.hoisted(() => vi.fn());
const mockDeleteAdapter = vi.hoisted(() => vi.fn());
const mockSaveAdapter = vi.hoisted(() => vi.fn());
const mockSaveDatasetEntries = vi.hoisted(() => vi.fn());
const mockExtractScenePairs = vi.hoisted(() => vi.fn());
const mockScoreDatasetEntries = vi.hoisted(() => vi.fn());
const mockGenerateSyntheticPairs = vi.hoisted(() => vi.fn());
const mockStartTraining = vi.hoisted(() => vi.fn());
const mockAbortTraining = vi.hoisted(() => vi.fn());
const mockMergeAdapter = vi.hoisted(() => vi.fn());
const mockGeminiText = vi.hoisted(() => vi.fn());
const mockComputeStyleScore = vi.hoisted(() => vi.fn());
const mockTestOllamaPrompt = vi.hoisted(() => vi.fn());
const mockAssertLoraLocalOnly = vi.hoisted(() => vi.fn());

vi.mock('../../../services/loraAdapterService', () => ({
  listAdapters: mockListAdapters,
  activateAdapter: mockActivateAdapter,
  deactivateAdapter: mockDeactivateAdapter,
  deleteAdapter: mockDeleteAdapter,
  saveAdapter: mockSaveAdapter,
  saveDatasetEntries: mockSaveDatasetEntries,
}));

vi.mock('../../../services/lora/loraDatasetBuilder', () => ({
  extractScenePairs: mockExtractScenePairs,
  scoreDatasetEntries: mockScoreDatasetEntries,
  generateSyntheticPairs: mockGenerateSyntheticPairs,
}));

vi.mock('../../../services/lora/loraTrainingService', () => ({
  startTraining: mockStartTraining,
  abortTraining: mockAbortTraining,
  mergeAdapter: mockMergeAdapter,
}));

vi.mock('../../../services/geminiService', () => ({
  generateText: mockGeminiText,
}));

vi.mock('../../../services/lora/loraEvaluationService', () => ({
  computeStyleConsistencyScore: mockComputeStyleScore,
}));

vi.mock('../../../services/lora/loraOllamaService', () => ({
  testOllamaAdapterPrompt: mockTestOllamaPrompt,
}));

vi.mock('../../../services/ai/aiPolicy', () => ({
  assertLoraLocalOnly: mockAssertLoraLocalOnly,
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  abortTrainingThunk,
  activateAdapterThunk,
  buildDatasetThunk,
  deactivateAdapterThunk,
  deleteAdapterThunk,
  evaluateAdapterThunk,
  loadAdaptersThunk,
  mergeAdapterThunk,
  startTrainingThunk,
} from '../../../features/lora/loraThunks';

import type { HyperparamPreset } from '../../../features/lora/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDispatch() {
  return vi.fn();
}

function makeGetState(loraAdapters: unknown[] = [], currentRun: unknown = null) {
  return () => ({ lora: { adapters: loraAdapters, currentRun } });
}

// QNBS-v3: startTrainingThunk generates its own genuinely-random runId via uuid() — a getState mock that echoes the id from the dispatched trainingStarted payload lets a test target this specific invocation.
function makeGetStateFollowingDispatch(
  dispatch: ReturnType<typeof vi.fn>,
  currentRunOverrides: Record<string, unknown> = {},
) {
  return () => {
    const started = dispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string } | undefined)?.type === 'lora/trainingStarted',
    );
    const id = (started?.[0] as { payload?: { id?: string } } | undefined)?.payload?.id;
    return { lora: { adapters: [], currentRun: id ? { id, ...currentRunOverrides } : null } };
  };
}

// QNBS-v3: RTK thunk test helper. ThunkFn uses `any` for dispatch/getState to satisfy
// RTK's contravariant ThunkDispatch param — only call site, mocked in tests.
// biome-ignore lint/suspicious/noExplicitAny: RTK thunk test helper — necessary for dispatch/getState contravariance
type ThunkFn = (d: any, g: any, e: undefined) => unknown;
function run(thunkResult: ThunkFn, dispatch = makeDispatch(), getState = makeGetState()): unknown {
  return thunkResult(dispatch, getState, undefined);
}

const PRESET: HyperparamPreset = {
  id: 'writer-style-light',
  labelKey: 'writerStyleLight',
  descKey: 'writerStyleLightDesc',
  rank: 8,
  alpha: 16,
  epochs: 3,
  method: 'lora',
  targetModules: 'q_v',
  maxSeqLen: 512,
  estimatedMinutes: 15,
  requiredVramGb: 8,
};

// ---------------------------------------------------------------------------
// Tests: loadAdaptersThunk
// ---------------------------------------------------------------------------

describe('loadAdaptersThunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches adaptersLoaded with mapped status', async () => {
    mockListAdapters.mockResolvedValue([
      { id: 'a1', isActive: true, name: 'Adapter 1' },
      { id: 'a2', isActive: false, name: 'Adapter 2' },
    ]);
    const dispatch = makeDispatch();
    await run(loadAdaptersThunk(), dispatch);
    const adaptersCall = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/adaptersLoaded');
    expect(adaptersCall).toBeDefined();
    const payload = adaptersCall![0].payload as Array<{ id: string; status: string }>;
    expect(payload.find((a) => a.id === 'a1')?.status).toBe('active');
    expect(payload.find((a) => a.id === 'a2')?.status).toBe('idle');
  });

  it('dispatches fulfilled on success', async () => {
    mockListAdapters.mockResolvedValue([]);
    const dispatch = makeDispatch();
    await run(loadAdaptersThunk(), dispatch);
    const types = dispatch.mock.calls.map((c) => c[0]?.type);
    expect(types).toContain('lora/loadAdapters/fulfilled');
  });
});

// ---------------------------------------------------------------------------
// Tests: activateAdapterThunk
// ---------------------------------------------------------------------------

describe('activateAdapterThunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActivateAdapter.mockResolvedValue(undefined);
  });

  it('calls activateAdapter service with correct id', async () => {
    const dispatch = makeDispatch();
    await run(activateAdapterThunk('adapter-42'), dispatch);
    expect(mockActivateAdapter).toHaveBeenCalledWith('adapter-42');
  });

  it('dispatches setActiveAdapter with the id', async () => {
    const dispatch = makeDispatch();
    await run(activateAdapterThunk('adapter-42'), dispatch);
    const setActive = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/setActiveAdapter');
    expect(setActive![0].payload).toBe('adapter-42');
  });
});

// ---------------------------------------------------------------------------
// Tests: deactivateAdapterThunk
// ---------------------------------------------------------------------------

describe('deactivateAdapterThunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeactivateAdapter.mockResolvedValue(undefined);
  });

  it('calls deactivateAdapter service', async () => {
    const dispatch = makeDispatch();
    await run(deactivateAdapterThunk(), dispatch);
    expect(mockDeactivateAdapter).toHaveBeenCalled();
  });

  it('dispatches setActiveAdapter with null', async () => {
    const dispatch = makeDispatch();
    await run(deactivateAdapterThunk(), dispatch);
    const setActive = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/setActiveAdapter');
    expect(setActive![0].payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: deleteAdapterThunk
// ---------------------------------------------------------------------------

describe('deleteAdapterThunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAdapter.mockResolvedValue(undefined);
  });

  it('calls deleteAdapter service with the id', async () => {
    const dispatch = makeDispatch();
    await run(deleteAdapterThunk('del-1'), dispatch);
    expect(mockDeleteAdapter).toHaveBeenCalledWith('del-1');
  });

  it('dispatches adapterDeleted with the id', async () => {
    const dispatch = makeDispatch();
    await run(deleteAdapterThunk('del-1'), dispatch);
    const deleted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/adapterDeleted');
    expect(deleted![0].payload).toBe('del-1');
  });
});

// ---------------------------------------------------------------------------
// Tests: buildDatasetThunk
// ---------------------------------------------------------------------------

describe('buildDatasetThunk', () => {
  const baseEntries = [
    { id: 'e1', prompt: 'p1', completion: 'c1', score: 0.9 },
    { id: 'e2', prompt: 'p2', completion: 'c2', score: 0.8 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractScenePairs.mockResolvedValue(baseEntries);
    mockScoreDatasetEntries.mockResolvedValue(baseEntries);
    mockSaveDatasetEntries.mockResolvedValue(undefined);
  });

  it('dispatches setIsBuilding(true) then setIsBuilding(false)', async () => {
    const dispatch = makeDispatch();
    await run(buildDatasetThunk({ projectId: 'proj-1' }), dispatch);
    const buildingCalls = dispatch.mock.calls
      .filter((c) => c[0]?.type === 'lora/setIsBuilding')
      .map((c) => c[0].payload);
    expect(buildingCalls[0]).toBe(true);
    expect(buildingCalls[buildingCalls.length - 1]).toBe(false);
  });

  it('dispatches datasetBuilt with projectId and entries', async () => {
    const dispatch = makeDispatch();
    await run(buildDatasetThunk({ projectId: 'proj-1' }), dispatch);
    const builtCall = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/datasetBuilt');
    expect(builtCall![0].payload.projectId).toBe('proj-1');
    expect(builtCall![0].payload.entries).toHaveLength(2);
  });

  it('generates synthetic pairs when includeSynthetic=true and count>0', async () => {
    const synth = [{ id: 's1', prompt: 'sp', completion: 'sc', score: 0.7 }];
    mockGenerateSyntheticPairs.mockResolvedValue(synth);
    const dispatch = makeDispatch();
    await run(
      buildDatasetThunk({ projectId: 'proj-1', includeSynthetic: true, syntheticCount: 5 }),
      dispatch,
    );
    expect(mockGenerateSyntheticPairs).toHaveBeenCalledWith(
      baseEntries,
      5,
      expect.any(AbortSignal),
    );
    const builtCall = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/datasetBuilt');
    expect(builtCall![0].payload.entries).toHaveLength(3); // 2 base + 1 synthetic
  });

  it('does NOT generate synthetic pairs when includeSynthetic=false', async () => {
    const dispatch = makeDispatch();
    await run(buildDatasetThunk({ projectId: 'proj-1', includeSynthetic: false }), dispatch);
    expect(mockGenerateSyntheticPairs).not.toHaveBeenCalled();
  });

  it('still dispatches setIsBuilding(false) on error (finally block)', async () => {
    mockExtractScenePairs.mockRejectedValue(new Error('IDB error'));
    const dispatch = makeDispatch();
    await run(buildDatasetThunk({ projectId: 'proj-1' }), dispatch);
    const buildingCalls = dispatch.mock.calls
      .filter((c) => c[0]?.type === 'lora/setIsBuilding')
      .map((c) => c[0].payload);
    expect(buildingCalls[buildingCalls.length - 1]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: startTrainingThunk
// ---------------------------------------------------------------------------

describe('startTrainingThunk', () => {
  const trainConfig = {
    projectId: 'proj-1',
    baseModelId: 'llama-3.2-7b',
    datasetPath: '/data/dataset.jsonl',
    outputDir: '/output',
    preset: PRESET,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertLoraLocalOnly.mockReturnValue(undefined);
    mockStartTraining.mockResolvedValue({ adapterPath: '/output/adapter.safetensors' });
    mockSaveAdapter.mockResolvedValue(undefined);
  });

  it('dispatches trainingStarted with runId and config', async () => {
    const dispatch = makeDispatch();
    await run(startTrainingThunk(trainConfig), dispatch);
    const started = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingStarted');
    expect(started).toBeDefined();
    expect(started![0].payload.projectId).toBe('proj-1');
    expect(started![0].payload.totalEpochs).toBe(3);
  });

  it('dispatches trainingCompleted on success', async () => {
    const dispatch = makeDispatch();
    await run(startTrainingThunk(trainConfig), dispatch);
    const completed = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingCompleted');
    expect(completed).toBeDefined();
  });

  it('dispatches trainingFailed on service error', async () => {
    mockStartTraining.mockRejectedValue(new Error('GPU out of memory'));
    const dispatch = makeDispatch();
    const getState = makeGetStateFollowingDispatch(dispatch);
    await run(startTrainingThunk(trainConfig), dispatch, getState);
    const failed = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingFailed');
    expect(failed![0].payload).toBe('GPU out of memory');
  });

  it('uses customEpochs when provided', async () => {
    const dispatch = makeDispatch();
    await run(startTrainingThunk({ ...trainConfig, customEpochs: 10 }), dispatch);
    const started = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingStarted');
    expect(started![0].payload.totalEpochs).toBe(10);
  });

  it('dispatches trainingAborted instead of trainingFailed when a cancellation was requested', async () => {
    // QNBS-v3: abort_lora_training killing the process makes train_lora reject first — the rejection must be classified as an abort, not a failure, when cancellationRequested is set.
    mockStartTraining.mockRejectedValue(new Error('training_cancel_not_confirmed'));
    const dispatch = makeDispatch();
    const getState = makeGetStateFollowingDispatch(dispatch, { cancellationRequested: true });
    await run(startTrainingThunk(trainConfig), dispatch, getState);
    const aborted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingAborted');
    const failed = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingFailed');
    expect(aborted).toBeDefined();
    expect(failed).toBeUndefined();
  });

  it('does not dispatch a terminal action when a newer run has already superseded this one', async () => {
    // QNBS-v3: abort_lora_training awaits child-process exit, so a killed train_lora invoke can reject after a NEW run started — dispatching against the stale runId would wrongly terminate the newer run.
    mockStartTraining.mockRejectedValue(
      new Error('stale rejection from an already-superseded run'),
    );
    const dispatch = makeDispatch();
    const getState = () => ({
      lora: {
        adapters: [],
        currentRun: { id: 'a-different-newer-run-id', cancellationRequested: false },
      },
    });
    await run(startTrainingThunk(trainConfig), dispatch, getState);
    const aborted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingAborted');
    const failed = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingFailed');
    expect(aborted).toBeUndefined();
    expect(failed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: abortTrainingThunk
// ---------------------------------------------------------------------------

describe('abortTrainingThunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAbortTraining.mockResolvedValue('confirmed');
  });

  it('calls abortTraining service and dispatches trainingAborted when a process was confirmed stopped', async () => {
    const dispatch = makeDispatch();
    await run(abortTrainingThunk(), dispatch);
    expect(mockAbortTraining).toHaveBeenCalled();
    const aborted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingAborted');
    expect(aborted).toBeDefined();
  });

  it('dispatches trainingCancellationRequested before awaiting the native abort', async () => {
    // QNBS-v3: a deferred (manually-resolved) abort promise proves the dispatch happens before the
    // await actually settles — an immediately-resolving mock can't distinguish "before the await"
    // from "after it resolved but before the next dispatch," since both produce the same final order.
    let resolveAbort!: (outcome: 'confirmed') => void;
    mockAbortTraining.mockReturnValue(
      new Promise<'confirmed'>((resolve) => {
        resolveAbort = resolve;
      }),
    );
    const dispatch = makeDispatch();
    const pending = run(abortTrainingThunk(), dispatch);
    await Promise.resolve();
    const requested = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/trainingCancellationRequested',
    );
    expect(requested).toBeDefined();
    expect(dispatch.mock.calls.some((c) => c[0]?.type === 'lora/trainingAborted')).toBe(false);
    resolveAbort('confirmed');
    await pending;
    expect(dispatch.mock.calls.some((c) => c[0]?.type === 'lora/trainingAborted')).toBe(true);
  });

  it('clears cancellationRequested when the native abort call fails', async () => {
    // QNBS-v3: regression test — a leaked cancellationRequested:true would misclassify this run's
    // later genuine failure (dispatched by startTrainingThunk's own catch) as a user abort.
    // QNBS-v3: createAsyncThunk always resolves (never rejects) its returned promise, dispatching a
    // '.../rejected' lifecycle action instead — so this asserts on that dispatch, not a thrown error.
    mockAbortTraining.mockRejectedValue(new Error('native abort failed'));
    const dispatch = makeDispatch();
    await run(abortTrainingThunk(), dispatch);
    const requested = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/trainingCancellationRequested',
    );
    const notConfirmed = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/trainingCancellationNotConfirmed',
    );
    const rejected = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/abortTraining/rejected');
    const aborted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingAborted');
    expect(requested).toBeDefined();
    expect(notConfirmed).toBeDefined();
    expect(rejected).toBeDefined();
    expect(aborted).toBeUndefined();
  });

  it('clears cancellationRequested without dispatching trainingAborted when nothing was actually running', async () => {
    // QNBS-v3 regression: abort_lora_training resolves successfully (not an error) for NothingRunning,
    // but that must not be treated as a confirmed cancellation of the current run — a coincidental,
    // unrelated training failure racing with this no-op must not be misattributed to it.
    mockAbortTraining.mockResolvedValue('nothing_to_cancel');
    const dispatch = makeDispatch();
    await run(abortTrainingThunk(), dispatch);
    const notConfirmed = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/trainingCancellationNotConfirmed',
    );
    const aborted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingAborted');
    const fulfilled = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/abortTraining/fulfilled',
    );
    expect(notConfirmed).toBeDefined();
    expect(aborted).toBeUndefined();
    expect(fulfilled).toBeDefined();
  });

  it('leaves cancellationRequested set (and dispatches neither terminal action) when a pending start is cancelled', async () => {
    // QNBS-v3 regression: CancelPendingStart previously mapped to the same "nothing to cancel"
    // outcome as a true no-op, clearing cancellationRequested before the pending train_lora
    // invocation's own training_cancelled rejection reached startTrainingThunk's catch — which then
    // misclassified a successful startup cancellation as a genuine training failure.
    mockAbortTraining.mockResolvedValue('pending_start_cancelled');
    const dispatch = makeDispatch();
    await run(abortTrainingThunk(), dispatch);
    const notConfirmed = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/trainingCancellationNotConfirmed',
    );
    const aborted = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/trainingAborted');
    const fulfilled = dispatch.mock.calls.find(
      (c) => c[0]?.type === 'lora/abortTraining/fulfilled',
    );
    expect(notConfirmed).toBeUndefined();
    expect(aborted).toBeUndefined();
    expect(fulfilled).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: mergeAdapterThunk
// ---------------------------------------------------------------------------

describe('mergeAdapterThunk', () => {
  const adapter = {
    id: 'a1',
    name: 'Test',
    localPath: '/adapters/a1.safetensors',
    format: 'safetensors' as const,
    status: 'idle' as const,
    modelCompatibility: 'llama',
    scale: 1.0,
    fileSizeBytes: 0,
    createdAt: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMergeAdapter.mockResolvedValue(undefined);
  });

  // QNBS-v3: mergeAdapterThunk reads getState().lora (typed RootState); cast to ThunkArg.
  it('calls mergeAdapter with correct args', async () => {
    const dispatch = makeDispatch();
    await run(
      mergeAdapterThunk({ adapterId: 'a1', baseModelId: 'llama-7b', outputPath: '/out' }),
      dispatch,
      makeGetState([adapter]),
    );
    expect(mockMergeAdapter).toHaveBeenCalledWith('llama-7b', '/adapters/a1.safetensors', '/out');
  });

  it('dispatches adapterMerged with updated format and path', async () => {
    const dispatch = makeDispatch();
    await run(
      mergeAdapterThunk({ adapterId: 'a1', baseModelId: 'llama-7b', outputPath: '/out' }),
      dispatch,
      makeGetState([adapter]),
    );
    const merged = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/adapterMerged');
    expect(merged![0].payload.format).toBe('merged-gguf');
    expect(merged![0].payload.localPath).toBe('/out');
  });

  it('dispatches rejected when adapter has no localPath', async () => {
    const noPath = { ...adapter, localPath: undefined };
    const dispatch = makeDispatch();
    await run(
      mergeAdapterThunk({ adapterId: 'a1', baseModelId: 'llama-7b', outputPath: '/out' }),
      dispatch,
      makeGetState([noPath]),
    );
    const rejected = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/mergeAdapter/rejected');
    expect(rejected).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: evaluateAdapterThunk
// ---------------------------------------------------------------------------

describe('evaluateAdapterThunk', () => {
  const adapter = {
    id: 'eval-1',
    name: 'Eval Adapter',
    localPath: '/adapters/eval.safetensors',
    format: 'safetensors' as const,
    status: 'idle' as const,
    modelCompatibility: 'llama',
    scale: 1.0,
    fileSizeBytes: 0,
    createdAt: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiText.mockResolvedValue('Base output text.');
    mockTestOllamaPrompt.mockResolvedValue('Adapted output text.');
    mockComputeStyleScore.mockResolvedValue({ consistencyScore: 0.87, details: [] });
  });

  // QNBS-v3: evaluateAdapterThunk uses getState().lora which requires typed RootState;
  // cast to ThunkArg to satisfy run()'s unknown-typed signature (safe — mock state matches).
  it('dispatches setIsEvaluating(true) on start', async () => {
    const dispatch = makeDispatch();
    await run(
      evaluateAdapterThunk({ adapterId: 'eval-1', testPrompts: ['Write a scene.'] }),
      dispatch,
      makeGetState([adapter]),
    );
    const isEvalCalls = dispatch.mock.calls.filter((c) => c[0]?.type === 'lora/setIsEvaluating');
    expect(isEvalCalls[0]![0].payload).toBe(true);
  });

  it('dispatches evaluationCompleted with the score report', async () => {
    const dispatch = makeDispatch();
    await run(
      evaluateAdapterThunk({ adapterId: 'eval-1', testPrompts: ['Prompt 1'] }),
      dispatch,
      makeGetState([adapter]),
    );
    const completed = dispatch.mock.calls.find((c) => c[0]?.type === 'lora/evaluationCompleted');
    expect(completed![0].payload.consistencyScore).toBe(0.87);
  });

  it('dispatches rejected when adapter not found', async () => {
    const dispatch = makeDispatch();
    await run(
      evaluateAdapterThunk({ adapterId: 'missing', testPrompts: ['p'] }),
      dispatch,
      makeGetState([]),
    );
    const rejected = dispatch.mock.calls.find((c) => c[0]?.type?.includes('rejected'));
    expect(rejected).toBeDefined();
  });

  it('falls back to base output when testOllamaPrompt throws', async () => {
    mockTestOllamaPrompt.mockRejectedValue(new Error('Ollama not running'));
    const dispatch = makeDispatch();
    await run(
      evaluateAdapterThunk({ adapterId: 'eval-1', testPrompts: ['Prompt 1'] }),
      dispatch,
      makeGetState([adapter]),
    );
    expect(mockComputeStyleScore).toHaveBeenCalled();
  });
});
