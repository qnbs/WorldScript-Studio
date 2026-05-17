import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateView } from '../../components/TemplateView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetFilter = vi.fn();
const mockOpenPreviewModal = vi.fn();
const mockCloseModal = vi.fn();
const mockSetModalState = vi.fn();

const baseContextValue = {
  t: (k: string) => k,
  language: 'en',
  filter: 'All' as const,
  setFilter: mockSetFilter,
  filteredTemplates: [
    {
      id: 'tpl-hero',
      name: 'templates.heroJourney.name',
      description: 'templates.heroJourney.description',
      type: 'Structure' as const,
      sections: [{ titleKey: 'templates.heroJourney.s1' }],
      tags: ['Adventure', 'Fantasy'],
    },
  ],
  modalState: 'closed' as const,
  setModalState: mockSetModalState,
  selectedTemplate: null,
  isAiLoading: false,
  openPreviewModal: mockOpenPreviewModal,
  closeModal: mockCloseModal,
  isRemixMode: false,
  setIsRemixMode: vi.fn(),
  remixedSections: [],
  draggedItem: { current: null },
  dragOverItem: { current: null },
  handleDragSort: vi.fn(),
  updateRemixedSectionTitle: vi.fn(),
  addRemixedSection: vi.fn(),
  deleteRemixedSection: vi.fn(),
  aiConcept: '',
  setAiConcept: vi.fn(),
  handleAiApply: vi.fn(),
  handleStandardApply: vi.fn(),
  customConcept: '',
  setCustomConcept: vi.fn(),
  customElements: '',
  setCustomElements: vi.fn(),
  customNumSections: 10,
  setCustomNumSections: vi.fn(),
  handleGenerateCustom: vi.fn(),
};

vi.mock('../../hooks/useTemplateView', () => ({
  useTemplateView: vi.fn(() => baseContextValue),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
  useAppSelectorShallow: vi.fn(),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    setTranscript: vi.fn(),
  })),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../components/ui/Toast', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn() })),
  Toast: () => null,
}));

vi.mock('../../services/communityTemplateService', () => ({
  fetchCommunityTemplates: vi.fn().mockResolvedValue([]),
}));

const mockOnNavigate = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateView', () => {
  it('renders without throwing', () => {
    expect(() => render(<TemplateView onNavigate={mockOnNavigate} />)).not.toThrow();
  });

  it('shows filter buttons', () => {
    render(<TemplateView onNavigate={mockOnNavigate} />);
    expect(screen.getByText('templates.filters.All')).toBeTruthy();
    expect(screen.getByText('templates.filters.Structure')).toBeTruthy();
    expect(screen.getByText('templates.filters.Genre')).toBeTruthy();
  });

  it('shows a template card', () => {
    render(<TemplateView onNavigate={mockOnNavigate} />);
    expect(screen.getByText('templates.heroJourney.name')).toBeTruthy();
  });

  it('shows the custom template create card', () => {
    render(<TemplateView onNavigate={mockOnNavigate} />);
    expect(screen.getByText('templates.custom.title')).toBeTruthy();
  });

  it('calls setFilter when Structure filter is clicked', () => {
    render(<TemplateView onNavigate={mockOnNavigate} />);
    fireEvent.click(screen.getByText('templates.filters.Structure'));
    expect(mockSetFilter).toHaveBeenCalledWith('Structure');
  });

  it('calls openPreviewModal when template preview button is clicked', () => {
    render(<TemplateView onNavigate={mockOnNavigate} />);
    fireEvent.click(screen.getByText('templates.previewAndRemix'));
    expect(mockOpenPreviewModal).toHaveBeenCalled();
  });
});
