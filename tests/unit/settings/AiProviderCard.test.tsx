import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiProviderCard } from '../../../components/settings/AiProviderCard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    getApiKey: vi.fn().mockResolvedValue(null),
    saveApiKey: vi.fn().mockResolvedValue(undefined),
    clearApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/aiProviderService', () => ({
  listOllamaModels: vi.fn().mockResolvedValue([]),
  scanLocalOpenAiCompatibleEndpoints: vi.fn().mockResolvedValue([]),
  testAIConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 100 }),
}));

vi.mock('../../../services/ai/localBackendPresets', () => ({
  LOCAL_BACKEND_PRESET_DEFAULT_URL: 'http://localhost:11434',
}));

const mockAdvancedAi = {
  model: 'gemini-2.5-flash' as const,
  provider: 'gemini' as const,
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.9,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
  customPrompts: {} as Record<string, string>,
  rateLimit: 60,
  ollamaBaseUrl: 'http://localhost:11434',
  localBackendPreset: 'ollama_default' as const,
  openAiCompatibleBaseUrl: '',
  openAiSiteUrl: '',
  openAiSiteTitle: 'StoryCraft Studio',
  hybridFallbackEnabled: false,
  hybridFallbackChain: [] as import('../../../types').AIProvider[],
  ragMode: 'hybrid' as const,
};

const mockOnAdvancedAiPatch = vi.fn();
const mockOnProviderChange = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiProviderCard', () => {
  it('renders without throwing', () => {
    expect(() =>
      render(
        <AiProviderCard
          advancedAi={mockAdvancedAi}
          onAdvancedAiPatch={mockOnAdvancedAiPatch}
          onProviderChange={mockOnProviderChange}
        />,
      ),
    ).not.toThrow();
  });

  it('shows provider title', () => {
    render(
      <AiProviderCard
        advancedAi={mockAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('settings.ai.providerTitle')).toBeTruthy();
  });

  it('shows all provider options', () => {
    render(
      <AiProviderCard
        advancedAi={mockAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('Google Gemini')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Ollama (lokal)')).toBeTruthy();
  });

  it('shows description text', () => {
    render(
      <AiProviderCard
        advancedAi={mockAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('settings.ai.providerDescription')).toBeTruthy();
  });
});
