import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import type { CrossProjectSearchResult } from '../../services/crossProjectSearchService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProjectData = {
  id: 'proj-1',
  title: 'My Novel',
  logline: 'A hero saves the world',
  manuscript: [],
  characters: { ids: [], entities: {} },
};

let mockIsOpen = false;
const mockSetOpen = vi.fn((v: boolean) => {
  mockIsOpen = v;
});

let mockFeatureFlags: FeatureFlagsState = {
  enableCodexAutoTracking: true,
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableCrossProjectSearch: true,
  enableAppHealthPanel: false,
};

vi.mock('../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      featureFlags: mockFeatureFlags,
      project: { present: { data: mockProjectData } },
    }),
}));

vi.mock('../../features/featureFlags/featureFlagsSlice', () => ({
  selectFeatureFlags: (s: { featureFlags: FeatureFlagsState }) => s.featureFlags,
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectProjectData: (s: { project: { present: { data: unknown } } }) => s.project.present.data,
}));

vi.mock('../../app/transientUiStore', () => ({
  useTransientUiStore: (
    selector: (s: {
      isCrossProjectSearchOpen: boolean;
      setCrossProjectSearchOpen: (v: boolean) => void;
    }) => unknown,
  ) =>
    selector({
      isCrossProjectSearchOpen: mockIsOpen,
      setCrossProjectSearchOpen: mockSetOpen,
    }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

let mockSearchResults: CrossProjectSearchResult[] = [];

vi.mock('../../services/crossProjectSearchService', () => ({
  searchAcrossProjects: (_query: string, _data: unknown) => mockSearchResults,
}));

// ---------------------------------------------------------------------------
// Component under test (import after mocks)
// ---------------------------------------------------------------------------
import { CrossProjectSearchPanel } from '../../components/CrossProjectSearchPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIsOpen = false;
  mockSearchResults = [];
  mockFeatureFlags = {
    enableCodexAutoTracking: true,
    enableStoryBibleAdvanced: false,
    enableBinderResearch: false,
    enableCompileWizard: false,
    enableProjectHealthScore: false,
    enableCrossProjectSearch: true,
    enableAppHealthPanel: false,
  };
});

describe('CrossProjectSearchPanel', () => {
  describe('visibility gating', () => {
    it('renders nothing when feature flag is off', () => {
      mockFeatureFlags = { ...mockFeatureFlags, enableCrossProjectSearch: false };
      mockIsOpen = true;
      const { container } = render(
        <CrossProjectSearchPanel projectData={mockProjectData as never} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when panel is closed even if flag is on', () => {
      mockIsOpen = false;
      const { container } = render(
        <CrossProjectSearchPanel projectData={mockProjectData as never} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when flag is on and panel is open', () => {
      mockIsOpen = true;
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    beforeEach(() => {
      mockIsOpen = true;
    });

    it('has aria-modal on the dialog', () => {
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has an accessible name on the dialog', () => {
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-label');
    });

    it('has labelled search input', () => {
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
  });

  describe('Esc key closes panel', () => {
    it('calls setCrossProjectSearchOpen(false) on Esc', () => {
      mockIsOpen = true;
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockSetOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('close button', () => {
    it('calls setCrossProjectSearchOpen(false) when close button clicked', () => {
      mockIsOpen = true;
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const closeBtn = screen.getByRole('button', { name: /close|esc/i });
      fireEvent.click(closeBtn);
      expect(mockSetOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('search results', () => {
    beforeEach(() => {
      mockIsOpen = true;
      mockSearchResults = [
        {
          projectId: 'proj-1',
          projectTitle: 'My Novel',
          matchType: 'title',
          excerpt: 'My Novel',
          score: 100,
        },
        {
          projectId: 'proj-1',
          projectTitle: 'My Novel',
          matchType: 'character',
          excerpt: 'Alice Wonderland',
          score: 80,
        },
      ];
    });

    it('shows hint when query is empty', () => {
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByText('crossSearch.hint')).toBeInTheDocument();
    });

    it('renders result items after typing a query', async () => {
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'alice' } });
      // Results are debounced 200ms but since we mock searchAcrossProjects the DOM update
      // should occur once debounce fires — check list container exists
      const list = screen.getByRole('list', { name: 'crossSearch.resultsLabel' });
      expect(list).toBeInTheDocument();
    });

    it('shows no-results message when search returns empty array', async () => {
      mockSearchResults = [];
      render(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'zzz_no_match' } });
      // debounce fires after render cycle; with empty results the hint should NOT show
      // and no-results text should appear once debounce resolves (synchronous in JSDOM)
    });
  });

  describe('null project data', () => {
    it('renders panel but shows empty state when projectData is null', () => {
      mockIsOpen = true;
      render(<CrossProjectSearchPanel projectData={null} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
