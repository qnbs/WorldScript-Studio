import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiSection } from '../../../components/settings/AiSections';
import { DataSection } from '../../../components/settings/DataSection';
import { EditorSection } from '../../../components/settings/EditorSections';
import { AppearanceSection, GeneralSection } from '../../../components/settings/GeneralSections';
import { SettingsModals } from '../../../components/settings/SettingsModals';
import { ShortcutsSection } from '../../../components/settings/ShortcutsSection';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const baseContextValue = {
  t: (k: string) => k,
  language: 'en',
  settings: {
    theme: 'dark',
    editorFont: 'serif',
    fontSize: 16,
    lineSpacing: 1.5,
    paragraphSpacing: 1.5,
    aiCreativity: 'Balanced',
    advancedAi: {},
    accessibility: { liveRegionVerbosity: 'full' },
    collaboration: { webrtcSignalingUrls: [] },
    featureFlags: {},
    appearancePreset: 'default',
    enableLanguageTool: false,
    languageToolUrl: '',
    keyboardShortcuts: [],
    themeCustomization: {
      primaryColor: '#6366f1',
      secondaryColor: '#a5b4fc',
      accentColor: '#4f46e5',
      backgroundColor: '#0f0f0f',
    },
  },
  featureFlags: {
    enableCompileWizard: false,
    enableManuscriptResearchSplit: false,
  },
  project: {
    title: 'My Story',
    manuscript: [],
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
  },
  activeCategory: 'general',
  setActiveCategory: vi.fn(),
  modal: { state: 'closed', payload: {} },
  setModal: vi.fn(),
  importFileRef: { current: null },
  snapshots: [],
  snapshotName: '',
  setSnapshotName: vi.fn(),
  handleLanguageChange: vi.fn(),
  handleSettingChange: vi.fn(),
  handleExport: vi.fn(),
  handleImport: vi.fn(),
  handleResetProject: vi.fn(),
  handleCreateSnapshot: vi.fn(),
  handleRestoreSnapshot: vi.fn(),
  handleDeleteSnapshot: vi.fn(),
  projectSize: '2.3 KB',
  currentWordCount: 0,
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: vi.fn(() => baseContextValue),
}));

vi.mock('../../../contexts/FeatureFlagsContext', () => ({
  useFeatureFlags: vi.fn(() => ({
    enableCompileWizard: false,
    enableManuscriptResearchSplit: false,
  })),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.5,
        paragraphSpacing: 1.5,
        aiCreativity: 'Balanced',
        advancedAi: {},
        keyboardShortcuts: [],
      },
      project: {
        present: {
          data: {
            title: 'My Story',
            manuscript: [],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
          },
        },
      },
      status: { isAiGenerating: false },
      featureFlags: {
        enableAppHealthPanel: false,
        enableCompileWizard: false,
        enableManuscriptResearchSplit: false,
        enableStoryBibleAdvanced: false,
        enableBinderResearch: false,
        enableProjectHealthScore: false,
      },
    }),
  ),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: vi.fn(
    (s: { project: { present: { data: unknown } } }) => s.project.present.data,
  ),
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: { setAiGenerating: vi.fn() },
}));

vi.mock('../../../services/localAiFacade', () => ({
  generateLocalText: vi.fn().mockResolvedValue({ layer: 'local', text: 'test' }),
}));

vi.mock('../../../services/localRagIndex', () => ({
  rebuildLocalRagIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/ai/modelRecommendations', () => ({
  RECOMMENDED_OLLAMA_MODEL_IDS: ['llama2'],
}));

vi.mock('../../../features/settings/keyboardShortcutsDefaults', () => ({
  SHORTCUT_ACTION_REGISTRY: [
    {
      action: 'toggle_palette',
      category: 'navigation',
      defaultKeys: ['ctrl', 'k'],
      labelKey: 'shortcuts.togglePalette',
    },
  ],
  getDefaultKeyboardShortcuts: vi.fn(() => []),
}));

vi.mock('../../../services/keyboard/shortcutConflicts', () => ({
  getShortcutConflictSignatures: vi.fn(() => []),
  serializeShortcutChord: vi.fn((keys: string[]) => keys.join('+')),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    hasSavedData: vi.fn().mockResolvedValue(false),
    listSnapshots: vi.fn().mockResolvedValue([]),
    getApiKey: vi.fn().mockResolvedValue(null),
    saveApiKey: vi.fn().mockResolvedValue(undefined),
    clearApiKey: vi.fn().mockResolvedValue(undefined),
    getGeminiApiKey: vi.fn().mockResolvedValue(null),
    hasGeminiApiKey: vi.fn().mockResolvedValue(false),
    saveGeminiApiKey: vi.fn().mockResolvedValue(undefined),
    clearGeminiApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../components/ApiKeySection', () => ({
  default: () => <div data-testid="api-key-section" />,
  ApiKeySection: () => <div data-testid="api-key-section" />,
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      value,
      onChange,
      options,
      groups,
      ariaLabel,
      ...rest
    }: {
      value: string;
      onChange: (v: string) => void;
      options?: Array<{ value: string; label: string; disabled?: boolean }>;
      groups?: Array<{
        label: string;
        options: Array<{ value: string; label: string; disabled?: boolean }>;
      }>;
      ariaLabel?: string;
      [key: string]: unknown;
    }) => (
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      >
        {(options ?? groups?.flatMap((g) => g.options) ?? []).map(
          (opt: { value: string; label: string; disabled?: boolean }) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeneralSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<GeneralSection />)).not.toThrow();
  });

  it('shows language title', () => {
    render(<GeneralSection />);
    expect(screen.getByText('settings.language.title')).toBeTruthy();
  });

  it('shows language selector', () => {
    render(<GeneralSection />);
    // QNBS-v3: LanguageSelector is a custom dropdown with aria-label
    expect(screen.getByLabelText('portal.language.groupLabel')).toBeTruthy();
  });
});

describe('AppearanceSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<AppearanceSection />)).not.toThrow();
  });

  it('shows appearance theme label', () => {
    render(<AppearanceSection />);
    expect(screen.getByText('settings.appearance.theme')).toBeTruthy();
  });
});

describe('AiSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<AiSection />)).not.toThrow();
  });
});

describe('EditorSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<EditorSection />)).not.toThrow();
  });
});

describe('DataSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<DataSection />)).not.toThrow();
  });
});

describe('ShortcutsSection', () => {
  it('renders without throwing', () => {
    expect(() => render(<ShortcutsSection />)).not.toThrow();
  });

  it('shows at least one shortcut row', () => {
    render(<ShortcutsSection />);
    expect(screen.getByText('shortcuts.togglePalette')).toBeTruthy();
  });
});

describe('SettingsModals', () => {
  it('renders nothing when modal is closed', () => {
    const { container } = render(<SettingsModals />);
    // modal.state === 'closed' → returns null
    expect(container.firstChild).toBeNull();
  });
});
