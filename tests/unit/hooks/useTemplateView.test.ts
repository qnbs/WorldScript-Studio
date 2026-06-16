import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTemplateView } from '../../../hooks/useTemplateView';

// ---------------------------------------------------------------------------
// vi.hoisted — thunk match fns + template data (must be hoisted; vi.mock is hoisted)
// ---------------------------------------------------------------------------
const { mockPersonalizeMatch, mockCustomMatch, MOCK_TEMPLATES } = vi.hoisted(() => {
  const templates = [
    {
      id: 'hero',
      name: "Hero's Journey",
      description: 'Classic structure',
      type: 'Structure' as const,
      tags: ['classic'],
      arcDescription: 'The hero departs',
      sections: [{ titleKey: 'templates.hero.act1' }, { titleKey: 'templates.hero.act2' }],
    },
    {
      id: 'thriller',
      name: 'Thriller',
      description: 'Fast-paced',
      type: 'Genre' as const,
      tags: ['action'],
      arcDescription: 'Tension builds',
      sections: [{ titleKey: 'templates.thriller.opening' }],
    },
  ];
  return {
    mockPersonalizeMatch: vi.fn((_: unknown) => true),
    mockCustomMatch: vi.fn((_: unknown) => true),
    MOCK_TEMPLATES: templates,
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

// QNBS-v3: mock constants so tests are not coupled to the real template list
vi.mock('../../../constants', () => ({
  STORY_TEMPLATES: MOCK_TEMPLATES,
}));

vi.mock('../../../features/project/thunks/outlineThunks', () => {
  const personalizeThunk = vi.fn(() => ({ type: 'mock-personalize' }));
  (personalizeThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockPersonalizeMatch(a),
  };

  const customThunk = vi.fn(() => ({ type: 'mock-custom' }));
  (customThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockCustomMatch(a),
  };

  return {
    personalizeTemplateThunk: personalizeThunk,
    generateCustomTemplateThunk: customThunk,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTemplateHook() {
  return renderHook(() => useTemplateView({ onNavigate: mockNavigate }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ type: 'mock-action' });
  mockPersonalizeMatch.mockReturnValue(true);
  mockCustomMatch.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// filteredTemplates
// ---------------------------------------------------------------------------
describe('filteredTemplates', () => {
  it('returns all templates when filter is All', () => {
    const { result } = renderTemplateHook();
    expect(result.current.filteredTemplates).toHaveLength(2);
  });

  it('filters to Structure templates only', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.setFilter('Structure');
    });
    expect(result.current.filteredTemplates).toHaveLength(1);
    expect(result.current.filteredTemplates[0]?.id).toBe('hero');
  });

  it('filters to Genre templates only', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.setFilter('Genre');
    });
    expect(result.current.filteredTemplates).toHaveLength(1);
    expect(result.current.filteredTemplates[0]?.id).toBe('thriller');
  });
});

// ---------------------------------------------------------------------------
// openPreviewModal / closeModal
// ---------------------------------------------------------------------------
describe('openPreviewModal', () => {
  it('sets selectedTemplate and opens preview modal', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    expect(result.current.selectedTemplate?.id).toBe('hero');
    expect(result.current.modalState).toBe('preview');
  });

  it('initialises remixedSections from template sections', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    expect(result.current.remixedSections).toHaveLength(2);
  });
});

describe('closeModal', () => {
  it('resets modal state and selectedTemplate', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
      result.current.closeModal();
    });
    expect(result.current.modalState).toBe('closed');
    expect(result.current.selectedTemplate).toBeNull();
    expect(result.current.isRemixMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleStandardApply
// ---------------------------------------------------------------------------
describe('handleStandardApply', () => {
  it('dispatches setManuscript and setOutline, calls onNavigate', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
      result.current.handleStandardApply();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setOutline' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('manuscript');
  });

  it('closes the modal after applying', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
      result.current.handleStandardApply();
    });
    expect(result.current.modalState).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// applyCommunityTemplate
// ---------------------------------------------------------------------------
describe('applyCommunityTemplate', () => {
  it('dispatches setManuscript/setOutline from community sections and navigates', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.applyCommunityTemplate({
        id: 'ct1',
        name: 'Heist',
        description: 'desc',
        type: 'Genre',
        tags: [],
        arcDescription: '',
        author: 'tester',
        sections: [{ title: 'Setup', description: 'The crew assembles' }, { title: 'Twist' }],
      });
    });
    const manuscriptCall = mockDispatch.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { type?: string } | undefined)?.type === 'project/setManuscript',
    );
    const manuscript = (
      manuscriptCall?.[0] as { payload: Array<{ content: string; prompt: string }> } | undefined
    )?.payload;
    expect(manuscript).toHaveLength(2);
    // Guidance goes into the writing brief (prompt); the manuscript content starts empty.
    expect(manuscript?.[0]?.content).toBe('');
    expect(manuscript?.[0]?.prompt).toContain('The crew assembles');
    expect(manuscript?.[1]?.content).toBe('');
    expect(manuscript?.[1]?.prompt).toBe('');
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setOutline' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('manuscript');
  });
});

// ---------------------------------------------------------------------------
// handleAiApply
// ---------------------------------------------------------------------------
describe('handleAiApply', () => {
  it('does nothing if no selectedTemplate', async () => {
    const { result } = renderTemplateHook();
    await act(async () => {
      await result.current.handleAiApply();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches setManuscript and navigates on fulfilled', async () => {
    mockDispatch.mockResolvedValue({
      type: 'fulfilled',
      payload: [{ title: 'Personalized Act 1' }],
    });
    mockPersonalizeMatch.mockReturnValue(true);

    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    await act(async () => {
      await result.current.handleAiApply();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('manuscript');
    expect(result.current.isAiLoading).toBe(false);
  });

  it('falls back to standard apply and shows error on rejected', async () => {
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockPersonalizeMatch.mockReturnValue(false);

    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    await act(async () => {
      await result.current.handleAiApply();
    });
    expect(mockToast.error).toHaveBeenCalled();
    // Still navigates via fallback applyToManuscript
    expect(mockNavigate).toHaveBeenCalledWith('manuscript');
  });
});

// ---------------------------------------------------------------------------
// handleGenerateCustom
// ---------------------------------------------------------------------------
describe('handleGenerateCustom', () => {
  it('dispatches setManuscript and navigates on fulfilled', async () => {
    mockDispatch.mockResolvedValue({
      type: 'fulfilled',
      payload: [{ title: 'Custom Act' }],
    });
    mockCustomMatch.mockReturnValue(true);

    const { result } = renderTemplateHook();
    await act(async () => {
      await result.current.handleGenerateCustom();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('manuscript');
  });

  it('shows error toast on rejected', async () => {
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockCustomMatch.mockReturnValue(false);

    const { result } = renderTemplateHook();
    await act(async () => {
      await result.current.handleGenerateCustom();
    });
    expect(mockToast.error).toHaveBeenCalled();
    expect(result.current.isAiLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Remix helpers
// ---------------------------------------------------------------------------
describe('addRemixedSection', () => {
  it('inserts new section after given index', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
      result.current.addRemixedSection(0);
    });
    expect(result.current.remixedSections).toHaveLength(3);
  });
});

describe('deleteRemixedSection', () => {
  it('removes section by id', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    const idToDelete = result.current.remixedSections[0]?.id;
    act(() => {
      result.current.deleteRemixedSection(idToDelete!);
    });
    expect(result.current.remixedSections).toHaveLength(1);
  });
});

describe('updateRemixedSectionTitle', () => {
  it('updates title of matching section', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    const id = result.current.remixedSections[0]?.id;
    act(() => {
      result.current.updateRemixedSectionTitle(id!, 'New Title');
    });
    expect(result.current.remixedSections[0]?.title).toBe('New Title');
  });
});

describe('handleDragSort', () => {
  it('does nothing when draggedItem is null', () => {
    const { result } = renderTemplateHook();
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
      result.current.handleDragSort();
    });
    // remixedSections unchanged — no error thrown
    expect(result.current.remixedSections).toHaveLength(2);
  });

  it('reorders sections when dragged/dragOver refs are set', () => {
    const { result } = renderTemplateHook();
    // QNBS-v3: openPreviewModal sets remixedSections via setState; handleDragSort
    // reads remixedSections from closure — must commit state before calling sort
    act(() => {
      result.current.openPreviewModal(MOCK_TEMPLATES[0]!);
    });
    act(() => {
      result.current.draggedItem.current = 1;
      result.current.dragOverItem.current = 0;
      result.current.handleDragSort();
    });
    // First section is now the one that was second
    expect(result.current.remixedSections[0]?.title).toBe('templates.hero.act2');
  });
});
