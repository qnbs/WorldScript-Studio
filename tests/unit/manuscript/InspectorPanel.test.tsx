/**
 * Tests for components/manuscript/InspectorPanel.tsx
 * QNBS-v3: Mocks ManuscriptViewContext + Redux hooks; tests inspector sections,
 *          stats, proofread, visualize, snapshot history, logline modal.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelector: vi.fn(() => []), // sectionSnapshots = []
}));

vi.mock('../../../features/versionControl/versionControlSlice', () => ({
  selectCurrentBranchSnapshots: vi.fn(() => []),
  decompressManuscript: vi.fn(() => []),
  versionControlActions: {
    createSnapshot: vi.fn((p: unknown) => ({ type: 'versionControl/createSnapshot', payload: p })),
  },
}));

vi.mock('../../../features/project/projectSlice', () => ({
  projectActions: {
    updateTitle: vi.fn((v: string) => ({ type: 'project/updateTitle', payload: v })),
    updateLogline: vi.fn((v: string) => ({ type: 'project/updateLogline', payload: v })),
    updateManuscriptSection: vi.fn((v: unknown) => ({
      type: 'project/updateManuscriptSection',
      payload: v,
    })),
  },
}));

vi.mock('../../../features/project/sectionRestoreHelpers', () => ({
  partialStorySectionFromSnapshot: vi.fn((s: unknown) => s),
}));

const mockHandleGenerateLoglines = vi.fn();
const mockHandleProofread = vi.fn();
const mockHandleVisualizeScene = vi.fn();
const mockSelectLogline = vi.fn();
const mockApplyProofreadSuggestion = vi.fn();
const mockSetIsLoglineModalOpen = vi.fn();

let mockIsAiLoading = false;
let mockIsProofreading = false;
let mockIsSceneVisualizing = false;
let mockIsLoglineModalOpen = false;
let mockActiveSection: { id: string; title: string; content: string } | null = null;
let mockLoglineSuggestions: string[] = [];
let mockProofreadSuggestions: Array<{ original: string; suggestion: string; explanation: string }> =
  [];
let mockSceneImagePreviewUrl: string | null = null;

vi.mock('../../../contexts/ManuscriptViewContext', () => ({
  useManuscriptViewContext: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    project: { title: 'My Novel', logline: 'A great story.' },
    manuscript: [{ id: 'sec-1', title: 'Chapter 1', content: 'content' }],
    activeSectionId: mockActiveSection?.id ?? null,
    activeSection: mockActiveSection,
    activeSectionStats: { wordCount: 1500, charCount: 8000, readTime: 6 },
    isLoglineModalOpen: mockIsLoglineModalOpen,
    setIsLoglineModalOpen: mockSetIsLoglineModalOpen,
    loglineSuggestions: mockLoglineSuggestions,
    isAiLoading: mockIsAiLoading,
    handleGenerateLoglines: mockHandleGenerateLoglines,
    selectLogline: mockSelectLogline,
    isProofreading: mockIsProofreading,
    handleProofread: mockHandleProofread,
    proofreadSuggestions: mockProofreadSuggestions,
    applyProofreadSuggestion: mockApplyProofreadSuggestion,
    isSceneVisualizing: mockIsSceneVisualizing,
    handleVisualizeScene: mockHandleVisualizeScene,
    sceneImagePreviewUrl: mockSceneImagePreviewUrl,
  }),
}));

vi.mock('../../../components/ui/DebouncedInput', () => ({
  DebouncedInput: ({
    id,
    value,
    placeholder,
  }: {
    id: string;
    value: string;
    placeholder?: string;
  }) => <input id={id} defaultValue={value} placeholder={placeholder} />,
}));

vi.mock('../../../components/ui/DebouncedTextarea', () => ({
  DebouncedTextarea: ({
    id,
    value,
    placeholder,
  }: {
    id: string;
    value: string;
    placeholder?: string;
  }) => <textarea id={id} defaultValue={value} placeholder={placeholder} />,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { InspectorPanel } from '../../../components/manuscript/InspectorPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InspectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAiLoading = false;
    mockIsProofreading = false;
    mockIsSceneVisualizing = false;
    mockIsLoglineModalOpen = false;
    mockActiveSection = null;
    mockLoglineSuggestions = [];
    mockProofreadSuggestions = [];
    mockSceneImagePreviewUrl = null;
  });

  it('renders project title input', () => {
    render(<InspectorPanel />);
    expect(screen.getByLabelText('dashboard.details.projectTitle')).toBeInTheDocument();
  });

  it('renders project logline textarea', () => {
    render(<InspectorPanel />);
    expect(screen.getByLabelText('dashboard.details.logline')).toBeInTheDocument();
  });

  it('renders AI logline button', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('dashboard.details.aiLoglineButton')).toBeInTheDocument();
  });

  it('calls handleGenerateLoglines when AI logline button clicked', async () => {
    const user = userEvent.setup();
    render(<InspectorPanel />);
    await user.click(screen.getByText('dashboard.details.aiLoglineButton'));
    expect(mockHandleGenerateLoglines).toHaveBeenCalled();
  });

  it('renders stats section', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('manuscript.inspector.statsTitle')).toBeInTheDocument();
  });

  it('renders word count stat', () => {
    render(<InspectorPanel />);
    // toLocaleString output varies by environment; match numeric content
    expect(screen.getByText(/1.?500/)).toBeInTheDocument();
  });

  it('renders char count stat', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/8.?000/)).toBeInTheDocument();
  });

  it('renders read time stat', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/manuscript.inspector.readTimeValue/)).toBeInTheDocument();
  });

  it('renders visualize button', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('manuscript.visualize.button')).toBeInTheDocument();
  });

  it('renders grammar check button', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('manuscript.grammar.checkButton')).toBeInTheDocument();
  });

  it('calls handleProofread when grammar check button clicked', async () => {
    const user = userEvent.setup();
    render(<InspectorPanel />);
    await user.click(screen.getByText('manuscript.grammar.checkButton'));
    expect(mockHandleProofread).toHaveBeenCalled();
  });

  it('calls handleVisualizeScene when visualize button clicked', async () => {
    const user = userEvent.setup();
    mockActiveSection = { id: 'sec-1', title: 'Chapter 1', content: 'some content here' };
    render(<InspectorPanel />);
    await user.click(screen.getByText('manuscript.visualize.button'));
    expect(mockHandleVisualizeScene).toHaveBeenCalled();
  });

  it('shows section history when activeSection exists', () => {
    mockActiveSection = { id: 'sec-1', title: 'Chapter 1', content: 'content' };
    render(<InspectorPanel />);
    expect(screen.getByText('manuscript.sectionHistory.title')).toBeInTheDocument();
  });

  it('shows empty snapshots message when no snapshots', () => {
    mockActiveSection = { id: 'sec-1', title: 'Chapter 1', content: 'content' };
    render(<InspectorPanel />);
    expect(screen.getByText('manuscript.sectionHistory.empty')).toBeInTheDocument();
  });

  it('renders proofread suggestions when present', () => {
    mockProofreadSuggestions = [
      { original: 'teh', suggestion: 'the', explanation: 'Typo correction' },
    ];
    render(<InspectorPanel />);
    expect(screen.getByText('teh')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
    expect(screen.getByText('Typo correction')).toBeInTheDocument();
  });

  it('shows scene image when sceneImagePreviewUrl is set', () => {
    mockSceneImagePreviewUrl = 'data:image/png;base64,abc123';
    const { container } = render(<InspectorPanel />);
    // Image has alt="" (decorative) so use DOM query instead of getByRole
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123');
  });

  it('aria-busy is true when AI is loading', () => {
    mockIsAiLoading = true;
    render(<InspectorPanel />);
    const section = screen.getByRole('region', { name: 'manuscript.inspector.regionAriaLabel' });
    expect(section).toHaveAttribute('aria-busy', 'true');
  });

  it('renders logline modal when isLoglineModalOpen is true', () => {
    mockIsLoglineModalOpen = true;
    mockLoglineSuggestions = ['A hero rises.', 'The end is near.'];
    render(<InspectorPanel />);
    expect(screen.getByText('A hero rises.')).toBeInTheDocument();
    expect(screen.getByText('The end is near.')).toBeInTheDocument();
  });
});
