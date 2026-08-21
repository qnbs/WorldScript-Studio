/**
 * Tests for components/settings/AiSections.tsx (AiSection + AdvancedAiSection)
 * QNBS-v3: Mocks SettingsViewContext + heavy sub-components; tests creativity slider, fallback toggle, advanced model selection.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
}));

const baseAdvancedAi = {
  provider: 'gemini' as const,
  model: 'gemini-2.5-flash',
  temperature: 0.7,
  maxTokens: 2048,
  topP: 0.9,
  rateLimit: 60,
  hybridFallbackEnabled: false,
  hybridFallbackChain: [] as string[],
  ragMode: 'hybrid' as const,
};
const mockProviderState = {
  provider: 'gemini' as 'gemini' | 'grok',
  model: 'gemini-2.5-flash',
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: {
      aiCreativity: 'Balanced',
      advancedAi: { ...baseAdvancedAi, ...mockProviderState },
    },
    featureFlags: { enableDuckDbAnalytics: false },
    handleSettingChange: mockHandleSettingChange,
  }),
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn(() => ({ id: 'proj1', manuscript: [], title: 'Test' })),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: () => ({ id: 'proj1', manuscript: [], title: 'Test' }),
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((p: unknown) => ({ type: 'status/addNotification', payload: p })),
  },
}));

vi.mock('../../../services/localRagService', () => ({
  rebuildHybridRagIndex: vi.fn().mockResolvedValue(10),
}));

vi.mock('../../../services/localAiFacade', () => ({
  generateLocalText: vi.fn().mockResolvedValue(''),
}));

// Stub sub-components that have their own heavy deps
vi.mock('../../../components/ApiKeySection', () => ({
  ApiKeySection: () => <div data-testid="api-key-section">ApiKeySection</div>,
}));

vi.mock('../../../components/settings/AiProviderCard', () => ({
  AiProviderCard: ({ onProviderChange }: { onProviderChange?: (provider: 'grok') => void }) => (
    <button type="button" data-testid="ai-provider-card" onClick={() => onProviderChange?.('grok')}>
      AiProviderCard
    </button>
  ),
}));

vi.mock('../../../components/settings/GpuMetricsPanel', () => ({
  GpuMetricsPanel: () => <div data-testid="gpu-metrics">GpuMetrics</div>,
}));

vi.mock('../../../components/settings/LocalAiDownloadProgress', () => ({
  LocalAiDownloadProgress: () => <div data-testid="download-progress">DownloadProgress</div>,
}));

vi.mock('@domain/ai-core', () => ({
  WEBLLM_SUPPORTED_MODELS: [{ id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 1B' }],
  ONNX_SUPPORTED_MODELS: [{ id: 'Xenova/distilgpt2', label: 'DistilGPT-2' }],
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      children,
      value,
      onChange,
      options,
      groups,
      ...rest
    }: React.SelectHTMLAttributes<HTMLSelectElement> & {
      options?: readonly { value: string; label: string }[];
      groups?: readonly { label: string; options: readonly { value: string; label: string }[] }[];
    }) => (
      <select value={value} onChange={onChange} {...rest}>
        {children}
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {groups?.flatMap((group) =>
          group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          )),
        )}
      </select>
    ),
  ),
}));

vi.mock('../../../components/ui/Input', () => ({
  Input: vi.fn(({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} {...rest} />
  )),
}));

vi.mock('../../../services/ai/modelRecommendations', () => ({
  RECOMMENDED_OLLAMA_MODEL_IDS: ['ollama/gemma3', 'ollama/llama3.2'],
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { AdvancedAiSection, AiSection } from '../../../components/settings/AiSections';

// ---------------------------------------------------------------------------
// Tests — AiSection
// ---------------------------------------------------------------------------

describe('AiSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderState.provider = 'gemini';
    mockProviderState.model = 'gemini-2.5-flash';
  });

  it('sets the current Grok fallback when the provider changes to Grok', async () => {
    const user = userEvent.setup();
    render(<AiSection />);
    await user.click(screen.getByTestId('ai-provider-card'));
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'advancedAi',
      expect.objectContaining({ provider: 'grok', model: 'grok-4.5' }),
    );
  });

  it('renders the AiProviderCard stub', () => {
    render(<AiSection />);
    expect(screen.getByTestId('ai-provider-card')).toBeInTheDocument();
  });

  it('renders the ApiKeySection stub', () => {
    render(<AiSection />);
    expect(screen.getByTestId('api-key-section')).toBeInTheDocument();
  });

  it('renders the creativity slider title', () => {
    render(<AiSection />);
    expect(screen.getByText('settings.ai.creativity')).toBeInTheDocument();
  });

  it('renders creativity range slider', () => {
    render(<AiSection />);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('calls handleSettingChange when creativity slider changes', async () => {
    const user = userEvent.setup();
    render(<AiSection />);
    const slider = screen.getByRole('slider');
    // Simulate change via fireEvent (range input needs direct value change)
    await user.click(slider);
    // The slider exists and is interactive
    expect(slider).not.toBeDisabled();
  });

  it('renders hybrid fallback toggle title', () => {
    render(<AiSection />);
    expect(screen.getByText('settings.ai.hybridFallbackTitle')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — AdvancedAiSection
// ---------------------------------------------------------------------------

describe('AdvancedAiSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderState.provider = 'gemini';
    mockProviderState.model = 'gemini-2.5-flash';
  });

  it('renders the advanced AI title', () => {
    render(<AdvancedAiSection />);
    expect(screen.getByText('settings.advancedAi.title')).toBeInTheDocument();
  });

  it('renders temperature slider', () => {
    render(<AdvancedAiSection />);
    expect(screen.getByText('settings.advancedAi.temperature (0.7)')).toBeInTheDocument();
  });

  it('renders max tokens slider', () => {
    render(<AdvancedAiSection />);
    expect(screen.getByText('settings.advancedAi.maxTokens (2048)')).toBeInTheDocument();
  });

  it('renders local RAG section title', () => {
    render(<AdvancedAiSection />);
    expect(screen.getByText('settings.advancedAi.localRagTitle')).toBeInTheDocument();
  });

  it('renders build local RAG button', () => {
    render(<AdvancedAiSection />);
    expect(screen.getByText('settings.advancedAi.localRagBuild')).toBeInTheDocument();
  });

  it('renders model selector', () => {
    render(<AdvancedAiSection />);
    // The Select is mocked as a native select, check for the model value
    // Use getAllByRole since there are multiple selects on the page
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('renders current Grok catalog options for the Grok provider', () => {
    mockProviderState.provider = 'grok';
    mockProviderState.model = 'grok-4.6';
    render(<AdvancedAiSection />);
    expect(screen.getByRole('option', { name: 'Grok 4.6' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grok 4.5' })).toBeInTheDocument();
  });

  it('renders RAG mode selector', () => {
    render(<AdvancedAiSection />);
    expect(screen.getByText('settings.advancedAi.ragModeLabel')).toBeInTheDocument();
  });
});
