/**
 * LoraView container tests — gating, sub-nav, wizard mode, onboarding.
 * QNBS-v3: v1.20 Phase 2.2. Child components + the useLoraView hook are mocked so the
 *          test isolates the container's composition logic.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoraView } from '../../../components/lora/LoraView';
import { useLoraView } from '../../../hooks/useLoraView';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ project: { present: { data: { id: 'p1' } } } }),
  ),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: (s: { project: { present: { data: unknown } } }) => s.project.present.data,
}));

vi.mock('../../../hooks/useLoraView', () => ({ useLoraView: vi.fn() }));

// Child component stubs — keep their real deps out of this container test.
vi.mock('../../../components/lora/LoraAdapterLibrary', () => ({
  default: () => <div data-testid="library" />,
}));
vi.mock('../../../components/lora/LoraDatasetBuilder', () => ({
  default: () => <div data-testid="dataset" />,
}));
vi.mock('../../../components/lora/LoraEvaluationPanel', () => ({
  default: () => <div data-testid="evaluation" />,
}));
vi.mock('../../../components/lora/LoraTrainingWizard', () => ({
  default: () => <div data-testid="wizard" />,
}));
vi.mock('../../../components/lora/LoraOnboarding', () => ({
  default: ({ onDismiss }: { onDismiss: () => void }) => (
    <button type="button" data-testid="onboarding" onClick={onDismiss}>
      onboarding
    </button>
  ),
}));

const mockUseLoraView = vi.mocked(useLoraView);

type LoraVm = ReturnType<typeof useLoraView>;

function vm(overrides: Partial<LoraVm>): LoraVm {
  return {
    isEnabled: true,
    adapters: [],
    activeView: 'library',
    error: null,
    onboardingDismissed: false,
    navigateTo: vi.fn(),
    dismissError: vi.fn(),
    dismissOnboarding: vi.fn(),
    ...overrides,
  } as unknown as LoraVm;
}

describe('LoraView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the flag-gate message when the feature is disabled', () => {
    mockUseLoraView.mockReturnValue(vm({ isEnabled: false }));
    render(<LoraView />);
    expect(screen.getByText('settings.loraAdapters.flagGate')).toBeInTheDocument();
    expect(screen.queryByTestId('library')).not.toBeInTheDocument();
  });

  it('renders the library and onboarding on first visit with no adapters', () => {
    mockUseLoraView.mockReturnValue(vm({ activeView: 'library', adapters: [] }));
    render(<LoraView />);
    expect(screen.getByTestId('library')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding')).toBeInTheDocument();
  });

  it('hides onboarding once an adapter exists', () => {
    mockUseLoraView.mockReturnValue(
      vm({ activeView: 'library', adapters: [{ id: 'a1' }] as unknown as LoraVm['adapters'] }),
    );
    render(<LoraView />);
    expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument();
  });

  it('hides onboarding when it has been dismissed (persisted state)', () => {
    mockUseLoraView.mockReturnValue(vm({ activeView: 'library', onboardingDismissed: true }));
    render(<LoraView />);
    expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument();
  });

  it('renders only the wizard (no sub-nav) in wizard mode', () => {
    mockUseLoraView.mockReturnValue(vm({ activeView: 'wizard' }));
    render(<LoraView />);
    expect(screen.getByTestId('wizard')).toBeInTheDocument();
    expect(screen.queryByTestId('library')).not.toBeInTheDocument();
    // Sub-nav (reused tab titles) is hidden while the wizard owns the view.
    expect(screen.queryByText('lora.dataset.title')).not.toBeInTheDocument();
  });

  it('navigates when a sub-nav tab is clicked', () => {
    const navigateTo = vi.fn();
    mockUseLoraView.mockReturnValue(vm({ activeView: 'library', navigateTo }));
    render(<LoraView />);
    fireEvent.click(screen.getByText('lora.dataset.title'));
    expect(navigateTo).toHaveBeenCalledWith('dataset');
  });

  it('shows and dismisses the error banner', () => {
    const dismissError = vi.fn();
    mockUseLoraView.mockReturnValue(vm({ error: 'boom', dismissError }));
    render(<LoraView />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByText('common.close'));
    expect(dismissError).toHaveBeenCalled();
  });
});
