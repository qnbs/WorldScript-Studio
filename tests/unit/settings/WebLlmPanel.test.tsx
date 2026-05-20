/**
 * WebLLM GPU-status badge and model-selector tests — rendered via AiProviderCard with provider:'webllm'.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AiProviderCard } from '../../../components/settings/AiProviderCard';

// ─── Hoisted mock refs ──────────────────────────────────────────────────────

// QNBS-v3: vi.hoisted makes the fn available inside the vi.mock factory (hoisted scope).
const mockDetectWebGpuDetails = vi.hoisted(() => vi.fn());

// ─── Module mocks ────────────────────────────────────────────────────────────

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

vi.mock('../../../services/ai/webGpuDetectorService', () => ({
  detectWebGpuDetails: mockDetectWebGpuDetails,
}));

vi.mock('@domain/ai-core', () => ({
  WEBLLM_SUPPORTED_MODELS: [
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (Test)', requiresGpu: true },
  ],
  ONNX_SUPPORTED_MODELS: [
    { id: 'Xenova/distilgpt2', label: 'DistilGPT-2 (Test)', requiresGpu: false },
  ],
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseAi = {
  model: 'gemini-2.5-flash' as const,
  provider: 'webllm' as const,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WebLLM provider panel', () => {
  it('renders GPU-unavailable badge when detectWebGpuDetails returns unavailable', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({ status: 'unavailable' });

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('settings.ai.webllm.gpuUnavailable')).toBeTruthy());
  });

  it('renders GPU-available badge when detectWebGpuDetails returns available', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({ status: 'available' });

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('settings.ai.webllm.gpuAvailable')).toBeTruthy());
  });

  it('renders GPU-unknown badge when detectWebGpuDetails returns unknown', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({ status: 'unknown' });

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('settings.ai.webllm.gpuUnknown')).toBeTruthy());
  });

  it('shows adapter name and vramTier when present', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({
      status: 'available',
      adapterDescription: 'NVIDIA GeForce RTX 3080',
      vramTier: 'high',
    });

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(/NVIDIA GeForce RTX 3080/)).toBeTruthy());
    expect(screen.getByText(/high/)).toBeTruthy();
  });

  it('WebLLM model selector has aria-label', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({ status: 'available' });

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    const select = await screen.findByRole('combobox', {
      name: 'settings.ai.webllm.modelSelectAriaLabel',
    });
    expect(select).toBeTruthy();
  });

  it('WebLLM model selector calls onModelSelect on change', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({ status: 'available' });
    const onModelSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <AiProviderCard
        advancedAi={baseAi}
        onAdvancedAiPatch={vi.fn()}
        onProviderChange={vi.fn()}
        onModelSelect={onModelSelect}
      />,
    );

    const select = await screen.findByRole('combobox', {
      name: 'settings.ai.webllm.modelSelectAriaLabel',
    });
    await user.selectOptions(select, 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
    expect(onModelSelect).toHaveBeenCalledWith('Llama-3.2-1B-Instruct-q4f16_1-MLC');
  });

  it('shows fallback chain and tab leader notes', async () => {
    mockDetectWebGpuDetails.mockResolvedValue({ status: 'available' });

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('settings.ai.webllm.fallbackChain')).toBeTruthy());
    expect(screen.getByText('settings.ai.webllm.tabLeaderNote')).toBeTruthy();
  });

  it('shows GPU-unknown badge when detectWebGpuDetails rejects', async () => {
    mockDetectWebGpuDetails.mockRejectedValue(new Error('GPU probe failed'));

    render(
      <AiProviderCard advancedAi={baseAi} onAdvancedAiPatch={vi.fn()} onProviderChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('settings.ai.webllm.gpuUnknown')).toBeTruthy());
  });
});
