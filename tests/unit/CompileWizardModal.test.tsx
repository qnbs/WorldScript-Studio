import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompileWizardModal } from '../../components/CompileWizardModal';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// QNBS-v3: full state provided so selector type matches TransientUiState (private — inferred)
const makeStoreState = (compileWizardOpen: boolean) => ({
  isCommandPaletteOpen: false,
  inspectorPanelWidth: 360,
  compileWizardOpen,
  manuscriptResearchSplitOpen: false,
  manuscriptPinnedBinderNodeId: null as string | null,
  isCrossProjectSearchOpen: false,
  setCommandPaletteOpen: vi.fn(),
  setInspectorPanelWidth: vi.fn(),
  setCompileWizardOpen: vi.fn(),
  setManuscriptResearchSplitOpen: vi.fn(),
  setManuscriptPinnedBinderNodeId: vi.fn(),
  setCrossProjectSearchOpen: vi.fn(),
});

vi.mock('../../app/transientUiStore', () => ({
  useTransientUiStore: vi.fn((selector: (s: ReturnType<typeof makeStoreState>) => unknown) =>
    selector(makeStoreState(false)),
  ),
}));

const mockExportContext = {
  t: (k: string) => k,
  setFormat: vi.fn(),
  setContentToExport: vi.fn(),
  setPdfOptions: vi.fn(),
  handleDownload: vi.fn().mockResolvedValue(undefined),
  isExportLoading: false,
  project: { manuscript: [{ id: 's1', title: 'Ch 1', content: '' }] },
};

vi.mock('../../contexts/ExportViewContext', () => ({
  useExportViewContext: vi.fn(() => mockExportContext),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompileWizardModal', () => {
  it('renders without throwing when closed', () => {
    expect(() => render(<CompileWizardModal />)).not.toThrow();
  });

  it('does not show modal content when compileWizardOpen is false', () => {
    render(<CompileWizardModal />);
    expect(screen.queryByText('export.compileWizard.title')).toBeNull();
  });

  it('shows modal content when compileWizardOpen is true', async () => {
    const { useTransientUiStore } = await import('../../app/transientUiStore');
    vi.mocked(useTransientUiStore).mockImplementation(
      (selector: (s: ReturnType<typeof makeStoreState>) => unknown) =>
        selector(makeStoreState(true)),
    );
    render(<CompileWizardModal />);
    expect(screen.getByText('export.compileWizard.title')).toBeTruthy();
  });

  it('shows step label when open', async () => {
    const { useTransientUiStore } = await import('../../app/transientUiStore');
    vi.mocked(useTransientUiStore).mockImplementation(
      (selector: (s: ReturnType<typeof makeStoreState>) => unknown) =>
        selector(makeStoreState(true)),
    );
    render(<CompileWizardModal />);
    expect(screen.getByText('export.compileWizard.stepPreset')).toBeTruthy();
  });

  it('shows next button on step 0', async () => {
    const { useTransientUiStore } = await import('../../app/transientUiStore');
    vi.mocked(useTransientUiStore).mockImplementation(
      (selector: (s: ReturnType<typeof makeStoreState>) => unknown) =>
        selector(makeStoreState(true)),
    );
    render(<CompileWizardModal />);
    expect(screen.getByText('export.compileWizard.next')).toBeTruthy();
  });
});
