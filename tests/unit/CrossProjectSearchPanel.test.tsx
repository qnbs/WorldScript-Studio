import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  enablePlotBoardV2: true,
  enableDuckDbAnalytics: false,
  enableObjectsGroups: false,
  enableMindMaps: false,
  enableCharacterInterviews: false,
  enableRtlLayout: false,
  enableCloudSync: false,
  enableLoraAdapters: false,
  enablePluginSystem: false,
  enableVoiceSupport: false,
  enableProForge: false,
  enableIdbAtRestEncryption: false,
  enableVoiceWasm: false,
  enableAdaptiveAiEngine: false,
  enableWebnnInference: false,
  enableComputeShaders: false,
  enableWorkerBusV2: false,
  enableRustCompute: false,
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
  searchAcrossProjectIndex: () => mockSearchResults,
}));

// QNBS-v3: mock IDB service so async promise resolves synchronously — prevents act() warnings
vi.mock('../../services/crossProjectIndexService', () => ({
  listIndexedProjects: () => Promise.resolve([]),
}));

// ---------------------------------------------------------------------------
// Component under test (import after mocks)
// ---------------------------------------------------------------------------
import { CrossProjectSearchPanel } from '../../components/CrossProjectSearchPanel';

// Flush listIndexedProjects promise + any rAF focus so effects are settled
async function renderOpen(ui: React.ReactElement) {
  await act(async () => {
    render(ui);
  });
}

beforeEach(() => {
  // QNBS-v3: fake timers prevent act() warnings from debounced state updates (200ms debounce)
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
    enablePlotBoardV2: true,
    enableDuckDbAnalytics: false,
    enableObjectsGroups: false,
    enableMindMaps: false,
    enableCharacterInterviews: false,
    enableRtlLayout: false,
    enableCloudSync: false,
    enableLoraAdapters: false,
    enablePluginSystem: false,
    enableVoiceSupport: false,
    enableProForge: false,
    enableIdbAtRestEncryption: false,
    enableVoiceWasm: false,
    enableAdaptiveAiEngine: false,
    enableWebnnInference: false,
    enableComputeShaders: false,
    enableWorkerBusV2: false,
    enableRustCompute: false,
  };
});

describe('CrossProjectSearchPanel', () => {
  describe('visibility gating', () => {
    it('renders nothing when feature flag is off', async () => {
      mockFeatureFlags = { ...mockFeatureFlags, enableCrossProjectSearch: false };
      mockIsOpen = true;
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(
          <CrossProjectSearchPanel projectData={mockProjectData as never} />,
        ));
      });
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when panel is closed even if flag is on', () => {
      mockIsOpen = false;
      const { container } = render(
        <CrossProjectSearchPanel projectData={mockProjectData as never} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when flag is on and panel is open', async () => {
      mockIsOpen = true;
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    beforeEach(() => {
      mockIsOpen = true;
    });

    it('has aria-modal on the dialog', async () => {
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has an accessible name on the dialog', async () => {
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-label');
    });

    it('has labelled search input', async () => {
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
  });

  describe('Esc key closes panel', () => {
    it('calls setCrossProjectSearchOpen(false) on Esc', async () => {
      mockIsOpen = true;
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockSetOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('close button', () => {
    it('calls setCrossProjectSearchOpen(false) when close button clicked', async () => {
      mockIsOpen = true;
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
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

    it('shows hint when query is empty', async () => {
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      expect(screen.getByText('crossSearch.hint')).toBeInTheDocument();
    });

    it('renders result items after typing a query', async () => {
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const input = screen.getByRole('searchbox');
      // Fire change then advance fake timers to flush the 200ms debounce
      fireEvent.change(input, { target: { value: 'alice' } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const list = screen.getByRole('list', { name: 'crossSearch.resultsLabel' });
      expect(list).toBeInTheDocument();
    });

    it('shows no-results message when search returns empty array', async () => {
      mockSearchResults = [];
      await renderOpen(<CrossProjectSearchPanel projectData={mockProjectData as never} />);
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'zzz_no_match' } });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      // with no results and a query, hint should not show
      expect(screen.queryByText('crossSearch.hint')).not.toBeInTheDocument();
    });
  });

  describe('null project data', () => {
    it('renders panel but shows empty state when projectData is null', async () => {
      mockIsOpen = true;
      await renderOpen(<CrossProjectSearchPanel projectData={null} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
