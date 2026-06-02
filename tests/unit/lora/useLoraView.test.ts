/**
 * useLoraView hook tests — verifies the selector→return mapping and that every
 * action/thunk callback dispatches the correct payload.
 * QNBS-v3: v1.20 Phase 3 (C-7 coverage climb). app/hooks, loraThunks, loraSelectors,
 *          and the feature-flag selector are mocked so the test isolates the hook's
 *          wiring (dispatch plumbing) without a real store or IDB/fs side effects.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dispatch spy shared across the mocked app/hooks module.
const dispatch = vi.fn((a: unknown) => a);

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => dispatch,
  // Mocked selectors ignore their argument and return fixed values, so just invoke them.
  useAppSelectorShallow: (sel: unknown) =>
    typeof sel === 'function' ? (sel as (s: unknown) => unknown)(undefined) : sel,
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableLoraAdapters: vi.fn(() => true),
}));

vi.mock('../../../features/lora/loraSelectors', () => ({
  selectActiveAdapter: vi.fn(() => ({ id: 'a1', name: 'Adapter 1' })),
  selectActiveAdapterId: vi.fn(() => 'a1'),
  selectDatasetForProject: vi.fn(() => () => []),
  selectIsBuilding: vi.fn(() => false),
  selectIsEvaluating: vi.fn(() => false),
  selectIsTraining: vi.fn(() => false),
  selectLastEvaluation: vi.fn(() => null),
  selectLoraActiveView: vi.fn(() => 'library'),
  selectLoraAdapters: vi.fn(() => []),
  selectLoraError: vi.fn(() => null),
  selectLoraOnboardingDismissed: vi.fn(() => false),
  selectRunHistory: vi.fn(() => []),
  selectSelectedBaseModel: vi.fn(() => ''),
  selectSelectedPreset: vi.fn(() => ({ id: 'writer-style-light', rank: 8, alpha: 16 })),
  selectSelectedPresetId: vi.fn(() => 'writer-style-light'),
  selectWizardStep: vi.fn(() => 'model'),
}));

// Each thunk creator returns a tagged object so we can assert it was dispatched.
vi.mock('../../../features/lora/loraThunks', () => ({
  abortTrainingThunk: vi.fn(() => ({ type: 'thunk/abortTraining' })),
  activateAdapterThunk: vi.fn((id: string) => ({ type: 'thunk/activate', id })),
  buildDatasetThunk: vi.fn((arg: unknown) => ({ type: 'thunk/buildDataset', arg })),
  deactivateAdapterThunk: vi.fn(() => ({ type: 'thunk/deactivate' })),
  deleteAdapterThunk: vi.fn((id: string) => ({ type: 'thunk/delete', id })),
  evaluateAdapterThunk: vi.fn((arg: unknown) => ({ type: 'thunk/evaluate', arg })),
  loadAdaptersThunk: vi.fn(() => ({ type: 'thunk/loadAdapters' })),
  mergeAdapterThunk: vi.fn((arg: unknown) => ({ type: 'thunk/merge', arg })),
  startTrainingThunk: vi.fn((arg: unknown) => ({ type: 'thunk/startTraining', arg })),
}));

import { useLoraView } from '../../../hooks/useLoraView';

/** Returns true if dispatch received an action whose `type` matches. */
function dispatchedType(type: string): boolean {
  return dispatch.mock.calls.some(([a]) => (a as { type?: string })?.type === type);
}
/** Returns the first dispatched action of a given type (for payload assertions). */
function dispatchedAction(type: string): Record<string, unknown> | undefined {
  return dispatch.mock.calls
    .map(([a]) => a as Record<string, unknown>)
    .find((a) => a?.['type'] === type);
}

describe('useLoraView', () => {
  beforeEach(() => {
    dispatch.mockClear();
  });

  it('exposes the selected slice state via the return value', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    expect(result.current.isEnabled).toBe(true);
    expect(result.current.activeView).toBe('library');
    expect(result.current.wizardStep).toBe('model');
    expect(result.current.selectedPresetId).toBe('writer-style-light');
    expect(result.current.activeAdapterId).toBe('a1');
    expect(result.current.datasetEntries).toEqual([]);
  });

  it('loads adapters on mount when the feature is enabled', () => {
    renderHook(() => useLoraView('p1'));
    expect(dispatchedType('thunk/loadAdapters')).toBe(true);
  });

  it('navigateTo dispatches setActiveView', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.navigateTo('dataset'));
    expect(dispatchedAction('lora/setActiveView')?.['payload']).toBe('dataset');
  });

  it('goToWizardStep dispatches setWizardStep', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.goToWizardStep('train'));
    expect(dispatchedAction('lora/setWizardStep')?.['payload']).toBe('train');
  });

  it('openWizard resets to the model step and opens the wizard view', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.openWizard());
    expect(dispatchedAction('lora/setWizardStep')?.['payload']).toBe('model');
    expect(dispatchedAction('lora/setActiveView')?.['payload']).toBe('wizard');
  });

  it('selectBaseModel and selectPreset dispatch their setters', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.selectBaseModel('unsloth/llama-3.2-7b'));
    act(() => result.current.selectPreset('deep-narrative'));
    expect(dispatchedAction('lora/setSelectedBaseModel')?.['payload']).toBe('unsloth/llama-3.2-7b');
    expect(dispatchedAction('lora/setSelectedPreset')?.['payload']).toBe('deep-narrative');
  });

  it('dismissError and dismissOnboarding dispatch their actions', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.dismissError());
    act(() => result.current.dismissOnboarding());
    expect(dispatchedType('lora/clearError')).toBe(true);
    expect(dispatchedType('lora/dismissOnboarding')).toBe(true);
  });

  it('adapter actions dispatch the matching thunks', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.activateAdapter('a2'));
    act(() => result.current.deactivateAdapter());
    act(() => result.current.deleteAdapter('a3'));
    act(() => result.current.mergeAdapter('a4', 'base', '/out'));
    expect(dispatchedAction('thunk/activate')?.['id']).toBe('a2');
    expect(dispatchedType('thunk/deactivate')).toBe(true);
    expect(dispatchedAction('thunk/delete')?.['id']).toBe('a3');
    expect(dispatchedType('thunk/merge')).toBe(true);
  });

  it('buildDataset dispatches buildDatasetThunk scoped to the project', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.buildDataset({ includeSynthetic: true }));
    const action = dispatchedAction('thunk/buildDataset');
    expect((action?.['arg'] as { projectId?: string })?.projectId).toBe('p1');
  });

  it('buildDataset is a no-op without a projectId', () => {
    const { result } = renderHook(() => useLoraView(undefined));
    act(() => result.current.buildDataset());
    expect(dispatchedType('thunk/buildDataset')).toBe(false);
  });

  it('startTraining dispatches startTrainingThunk with the selected preset and custom params', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.startTraining('base', '/data', '/out', { rank: 16, epochs: 3 }));
    const action = dispatchedAction('thunk/startTraining');
    const arg = action?.['arg'] as Record<string, unknown>;
    expect(arg?.['projectId']).toBe('p1');
    expect(arg?.['baseModelId']).toBe('base');
    expect(arg?.['customRank']).toBe(16);
    expect(arg?.['customEpochs']).toBe(3);
    // alpha was not provided → omitted (exactOptionalPropertyTypes-safe spread).
    expect(arg).not.toHaveProperty('customAlpha');
  });

  it('abortTraining and evaluate dispatch their thunks', () => {
    const { result } = renderHook(() => useLoraView('p1'));
    act(() => result.current.abortTraining());
    act(() => result.current.evaluate('a1', ['prompt']));
    expect(dispatchedType('thunk/abortTraining')).toBe(true);
    expect(dispatchedType('thunk/evaluate')).toBe(true);
  });
});
