/**
 * LoraTrainingWizard tests — step rendering, canProceed gating, next/back navigation,
 * model + preset selection, and the training/abort + deploy panels.
 * QNBS-v3: v1.20 Phase 3 (C-7 coverage climb). The LoraViewContext hook is mocked so the
 *          test drives each wizard step deterministically.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoraTrainingWizard from '../../../components/lora/LoraTrainingWizard';
import { useLoraViewContext } from '../../../contexts/LoraViewContext';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../contexts/LoraViewContext', () => ({ useLoraViewContext: vi.fn() }));

const mockCtx = vi.mocked(useLoraViewContext);
type Ctx = ReturnType<typeof useLoraViewContext>;

function ctx(overrides: Partial<Ctx>): Ctx {
  return {
    wizardStep: 'model',
    selectedBaseModel: '',
    selectedPresetId: 'writer-style-light',
    isTraining: false,
    activeAdapter: null,
    goToWizardStep: vi.fn(),
    navigateTo: vi.fn(),
    selectBaseModel: vi.fn(),
    selectPreset: vi.fn(),
    abortTraining: vi.fn(),
    ...overrides,
  } as unknown as Ctx;
}

describe('LoraTrainingWizard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the step indicator and model radios on the model step', () => {
    mockCtx.mockReturnValue(ctx({ wizardStep: 'model' }));
    render(<LoraTrainingWizard />);
    expect(screen.getByRole('navigation', { name: 'lora.wizard.steps.label' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Llama 3\.2 7B/i })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('disables Next until a base model is chosen, and selecting one fires selectBaseModel', () => {
    const selectBaseModel = vi.fn();
    mockCtx.mockReturnValue(ctx({ wizardStep: 'model', selectedBaseModel: '', selectBaseModel }));
    render(<LoraTrainingWizard />);
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Llama 3\.2 7B/i }));
    expect(selectBaseModel).toHaveBeenCalledWith('unsloth/llama-3.2-7b-instruct-bnb-4bit');
  });

  it('enables Next once a base model is selected and advances to dataset', () => {
    const goToWizardStep = vi.fn();
    mockCtx.mockReturnValue(ctx({ wizardStep: 'model', selectedBaseModel: 'm', goToWizardStep }));
    render(<LoraTrainingWizard />);
    const next = screen.getByRole('button', { name: 'common.next' });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(goToWizardStep).toHaveBeenCalledWith('dataset');
  });

  it('shows Cancel (not Back) on the first step and returns to the library', () => {
    const navigateTo = vi.fn();
    mockCtx.mockReturnValue(ctx({ wizardStep: 'model', navigateTo }));
    render(<LoraTrainingWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(navigateTo).toHaveBeenCalledWith('library');
  });

  it('on the dataset step Back returns to model and Next goes to params', () => {
    const goToWizardStep = vi.fn();
    mockCtx.mockReturnValue(ctx({ wizardStep: 'dataset', goToWizardStep }));
    render(<LoraTrainingWizard />);
    expect(screen.getByText('lora.wizard.dataset.instruction')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
    expect(goToWizardStep).toHaveBeenCalledWith('model');
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }));
    expect(goToWizardStep).toHaveBeenCalledWith('params');
  });

  it('renders preset radios on the params step and selecting one fires selectPreset', () => {
    const selectPreset = vi.fn();
    mockCtx.mockReturnValue(ctx({ wizardStep: 'params', selectPreset }));
    render(<LoraTrainingWizard />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(1);
    fireEvent.click(radios[radios.length - 1] as HTMLElement);
    expect(selectPreset).toHaveBeenCalled();
  });

  it('on the train step shows the ready message and Next is enabled when not training', () => {
    mockCtx.mockReturnValue(ctx({ wizardStep: 'train', isTraining: false }));
    render(<LoraTrainingWizard />);
    expect(screen.getByText('lora.wizard.training.ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.next' })).toBeEnabled();
  });

  it('while training shows the spinner, disables Next, and Abort fires abortTraining', () => {
    const abortTraining = vi.fn();
    mockCtx.mockReturnValue(ctx({ wizardStep: 'train', isTraining: true, abortTraining }));
    render(<LoraTrainingWizard />);
    expect(screen.getByText('lora.wizard.training.inProgress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'lora.wizard.abort' }));
    expect(abortTraining).toHaveBeenCalled();
  });

  it('on the deploy step hides the Next button and shows the deploy title', () => {
    mockCtx.mockReturnValue(ctx({ wizardStep: 'deploy' }));
    render(<LoraTrainingWizard />);
    expect(screen.getByText('lora.wizard.deploy.title')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.next' })).not.toBeInTheDocument();
  });

  it('on the deploy step shows the activated message when an adapter is active', () => {
    mockCtx.mockReturnValue(
      ctx({ wizardStep: 'deploy', activeAdapter: { name: 'My Style' } as Ctx['activeAdapter'] }),
    );
    render(<LoraTrainingWizard />);
    expect(screen.getByText('lora.wizard.deploy.activated')).toBeInTheDocument();
  });
});
