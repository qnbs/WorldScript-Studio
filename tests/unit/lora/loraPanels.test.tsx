/**
 * LoRA sub-panel tests — LoraAdapterLibrary, LoraDatasetBuilder, LoraEvaluationPanel.
 * QNBS-v3: v1.20 Phase 3 (C-7 coverage climb). LoraViewContext + the loraDatasetBuilder /
 *          loraEvaluationService helpers are mocked so each panel is tested in isolation.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoraAdapterLibrary from '../../../components/lora/LoraAdapterLibrary';
import LoraDatasetBuilder from '../../../components/lora/LoraDatasetBuilder';
import LoraEvaluationPanel from '../../../components/lora/LoraEvaluationPanel';
import { useLoraViewContext } from '../../../contexts/LoraViewContext';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../../../contexts/LoraViewContext', () => ({ useLoraViewContext: vi.fn() }));

const estimateDatasetQuality = vi.fn<(...a: unknown[]) => unknown>();
const exportAsJsonl = vi.fn<(...a: unknown[]) => string>(() => 'JSONL');
vi.mock('../../../services/lora/loraDatasetBuilder', () => ({
  estimateDatasetQuality: (...a: unknown[]) => estimateDatasetQuality(...a),
  exportAsJsonl: (...a: unknown[]) => exportAsJsonl(...a),
}));
vi.mock('../../../services/lora/loraEvaluationService', () => ({
  scoreLabel: vi.fn(() => 'good'),
}));

const mockCtx = vi.mocked(useLoraViewContext);
type Ctx = ReturnType<typeof useLoraViewContext>;
function ctx(overrides: Partial<Ctx>): Ctx {
  return { ...overrides } as unknown as Ctx;
}

describe('LoraAdapterLibrary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state and the start-training CTA', () => {
    const openWizard = vi.fn();
    mockCtx.mockReturnValue(ctx({ adapters: [], isTraining: false, openWizard }));
    render(<LoraAdapterLibrary />);
    expect(screen.getByText('lora.library.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'lora.wizard.startFirstTraining' }));
    expect(openWizard).toHaveBeenCalled();
  });

  it('disables the start CTA while training', () => {
    mockCtx.mockReturnValue(ctx({ adapters: [], isTraining: true, openWizard: vi.fn() }));
    render(<LoraAdapterLibrary />);
    expect(screen.getByRole('button', { name: 'lora.wizard.startFirstTraining' })).toBeDisabled();
  });

  it('lists adapters and activates an inactive one', () => {
    const activateAdapter = vi.fn();
    mockCtx.mockReturnValue(
      ctx({
        adapters: [
          {
            id: 'a1',
            name: 'Gothic Voice',
            isActive: false,
            modelCompatibility: 'llama-3.2',
            fileSizeBytes: 2 * 1024 * 1024,
            qualityScore: 0.82,
            version: 2,
          },
        ] as unknown as Ctx['adapters'],
        isTraining: false,
        openWizard: vi.fn(),
        activateAdapter,
        deactivateAdapter: vi.fn(),
        deleteAdapter: vi.fn(),
      }),
    );
    render(<LoraAdapterLibrary />);
    expect(screen.getByRole('heading', { name: 'Gothic Voice' })).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument(); // ScoreBadge
    fireEvent.click(screen.getByRole('button', { name: 'lora.adapter.activate' }));
    expect(activateAdapter).toHaveBeenCalledWith('a1');
  });

  it('deactivates the active adapter and deletes on demand', () => {
    const deactivateAdapter = vi.fn();
    const deleteAdapter = vi.fn();
    mockCtx.mockReturnValue(
      ctx({
        adapters: [
          {
            id: 'a1',
            name: 'Active One',
            isActive: true,
            modelCompatibility: 'llama-3.2',
            fileSizeBytes: 0,
          },
        ] as unknown as Ctx['adapters'],
        isTraining: false,
        openWizard: vi.fn(),
        activateAdapter: vi.fn(),
        deactivateAdapter,
        deleteAdapter,
      }),
    );
    render(<LoraAdapterLibrary />);
    fireEvent.click(screen.getByRole('button', { name: 'lora.adapter.deactivate' }));
    expect(deactivateAdapter).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'lora.adapter.delete' }));
    expect(deleteAdapter).toHaveBeenCalledWith('a1');
  });
});

describe('LoraDatasetBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estimateDatasetQuality.mockReturnValue({
      totalEntries: 0,
      acceptedEntries: 0,
      flaggedEntries: 0,
      rejectedEntries: 0,
      readyToTrain: false,
    });
  });

  it('shows the empty state and triggers extraction', () => {
    const buildDataset = vi.fn();
    mockCtx.mockReturnValue(ctx({ datasetEntries: [], isBuilding: false, buildDataset }));
    render(<LoraDatasetBuilder />);
    expect(screen.getByText('lora.dataset.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'lora.dataset.extract' }));
    expect(buildDataset).toHaveBeenCalled();
  });

  it('shows the extracting label and disables the button while building', () => {
    mockCtx.mockReturnValue(ctx({ datasetEntries: [], isBuilding: true, buildDataset: vi.fn() }));
    render(<LoraDatasetBuilder />);
    expect(screen.getByRole('button', { name: 'lora.dataset.extracting' })).toBeDisabled();
  });

  it('renders the quality summary, the not-enough warning, and exports JSONL', () => {
    estimateDatasetQuality.mockReturnValue({
      totalEntries: 3,
      acceptedEntries: 2,
      flaggedEntries: 1,
      rejectedEntries: 0,
      readyToTrain: false,
    });
    const createObjectURL = vi.fn(() => 'blob:url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    mockCtx.mockReturnValue(
      ctx({
        datasetEntries: [
          {
            id: 'd1',
            instruction: 'Continue',
            output: 'Once upon a time…',
            qualityScore: 0.7,
            source: 'extracted',
          },
          {
            id: 'd2',
            instruction: 'Describe',
            output: 'A dusty road…',
            qualityScore: 0.5,
            source: 'synthetic',
          },
        ] as unknown as Ctx['datasetEntries'],
        isBuilding: false,
        buildDataset: vi.fn(),
      }),
    );
    render(<LoraDatasetBuilder />);
    expect(screen.getByText('lora.dataset.notEnough')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /lora\.dataset\.export/ }));
    expect(exportAsJsonl).toHaveBeenCalledWith(expect.any(Array), 'alpaca');
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('LoraEvaluationPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the no-active-adapter message when none is active', () => {
    mockCtx.mockReturnValue(ctx({ activeAdapter: null }));
    render(<LoraEvaluationPanel />);
    expect(screen.getByText('lora.evaluation.noActiveAdapter')).toBeInTheDocument();
  });

  it('runs an evaluation against the active adapter', () => {
    const evaluate = vi.fn();
    mockCtx.mockReturnValue(
      ctx({
        activeAdapter: { id: 'a1', name: 'Voice' } as Ctx['activeAdapter'],
        isEvaluating: false,
        lastEvaluation: null,
        evaluate,
      }),
    );
    render(<LoraEvaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'lora.evaluation.run' }));
    expect(evaluate).toHaveBeenCalledWith('a1', expect.any(Array));
  });

  it('disables the run button while evaluating', () => {
    mockCtx.mockReturnValue(
      ctx({
        activeAdapter: { id: 'a1', name: 'Voice' } as Ctx['activeAdapter'],
        isEvaluating: true,
        lastEvaluation: null,
        evaluate: vi.fn(),
      }),
    );
    render(<LoraEvaluationPanel />);
    expect(screen.getByRole('button', { name: 'lora.evaluation.evaluating' })).toBeDisabled();
  });

  it('renders the score gauge and side-by-side comparisons from the last evaluation', () => {
    mockCtx.mockReturnValue(
      ctx({
        activeAdapter: { id: 'a1', name: 'Voice' } as Ctx['activeAdapter'],
        isEvaluating: false,
        evaluate: vi.fn(),
        lastEvaluation: {
          score: 0.74,
          baseline: 0.5,
          improvement: 0.24,
          sampleComparisons: [
            {
              prompt: 'Continue the scene',
              base: 'plain text',
              adapted: 'styled text',
              similarity: 0.8,
            },
          ],
        } as unknown as Ctx['lastEvaluation'],
      }),
    );
    render(<LoraEvaluationPanel />);
    expect(screen.getByRole('img', { name: /Style score: 74%/ })).toBeInTheDocument();
    expect(screen.getByText('Continue the scene')).toBeInTheDocument();
    expect(screen.getByText('styled text')).toBeInTheDocument();
  });
});
