import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderCard } from '../../../components/settings/AiProviderCard';
import {
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testAIConnection,
} from '../../../services/aiProviderService';

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
  LOCAL_BACKEND_PRESET_DEFAULT_URL: {
    ollama_default: 'http://localhost:11434',
    lm_studio: 'http://localhost:1234',
    vllm: 'http://localhost:8000',
    custom: 'http://localhost:11434',
  },
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
  openAiSiteTitle: 'WorldScript Studio',
  hybridFallbackEnabled: false,
  hybridFallbackChain: [] as import('../../../types').AIProvider[],
  ragMode: 'hybrid' as const,
};

const mockOnAdvancedAiPatch = vi.fn();
const mockOnProviderChange = vi.fn();

const ollamaAdvancedAi = { ...mockAdvancedAi, provider: 'ollama' as const };

function setDesktopRuntime(enabled: boolean): void {
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (enabled) {
    w.__TAURI_INTERNALS__ = {};
  } else {
    delete w.__TAURI_INTERNALS__;
  }
}

afterEach(() => {
  setDesktopRuntime(false);
  vi.clearAllMocks();
});

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

// ─── #266: ollama in the PWA vs desktop ──────────────────────────────────────

describe('AiProviderCard — ollama provider (#266)', () => {
  it('PWA: shows the desktop-only banner with download CTA and never probes localhost', async () => {
    setDesktopRuntime(false);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    expect(screen.getByText('settings.ai.ollamaDesktopOnlyTitle')).toBeTruthy();
    expect(screen.getByText('settings.ai.ollamaDesktopOnlyBody')).toBeTruthy();
    const cta = screen.getByRole('link', { name: /downloadDesktopCta/ });
    expect(cta.getAttribute('href')).toContain('github.com/qnbs/WorldScript-Studio/releases');
    expect(cta.getAttribute('rel')).toContain('noreferrer');

    // QNBS-v3 (#266): no auto-fetch in the browser — this is what killed the CORS console noise.
    await waitFor(() => {
      expect(screen.getByText('settings.ai.ollamaDesktopOnlyTitle')).toBeTruthy();
    });
    expect(listOllamaModels).not.toHaveBeenCalled();
    expect(testAIConnection).not.toHaveBeenCalled();
  });

  it('PWA: status badge shows "unavailable in browser", never the idle "Ready" label (matches the desktop-only banner instead of contradicting it)', () => {
    setDesktopRuntime(false);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('settings.ai.providerStatusUnavailableBrowser')).toBeTruthy();
    expect(screen.queryByText('settings.ai.providerStatusReady')).toBeNull();
  });

  it('desktop: status badge never shows "unavailable in browser" for ollama (real test result renders instead)', async () => {
    setDesktopRuntime(true);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    // The auto-test effect runs the mocked testAIConnection (ok:true); wait for it to settle.
    await waitFor(() => {
      expect(screen.getByText('settings.ai.providerStatusConnected')).toBeTruthy();
    });
    expect(screen.queryByText('settings.ai.providerStatusUnavailableBrowser')).toBeNull();
  });

  it('desktop: auto-loads models and tests the connection when ollama is selected', async () => {
    setDesktopRuntime(true);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    await waitFor(() => {
      expect(listOllamaModels).toHaveBeenCalled();
      expect(testAIConnection).toHaveBeenCalledWith('ollama', expect.any(Object));
    });
    expect(screen.queryByText('settings.ai.ollamaDesktopOnlyTitle')).toBeNull();
  });

  it('desktop: scan renders classified status badges and the use-url action patches settings', async () => {
    setDesktopRuntime(true);
    vi.mocked(scanLocalOpenAiCompatibleEndpoints).mockResolvedValueOnce([
      {
        labelKey: 'settings.ai.scanLabelOllama',
        baseUrl: 'http://localhost:11434',
        ok: true,
        state: 'ok',
        status: 200,
      },
      {
        labelKey: 'settings.ai.scanLabelLmStudio',
        baseUrl: 'http://localhost:1234',
        ok: false,
        state: 'timeout',
      },
      {
        labelKey: 'settings.ai.scanLabelVllm',
        baseUrl: 'http://localhost:8000',
        ok: false,
        state: 'http',
        status: 500,
      },
    ]);
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'settings.ai.scanLocalPorts' }));

    await waitFor(() => {
      expect(screen.getByText('settings.ai.scanOk')).toBeTruthy();
    });
    expect(screen.getByText('settings.ai.scanStateTimeout')).toBeTruthy();
    expect(screen.getByText(/scanStateHttp/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'settings.ai.scanUseUrl' }));
    expect(mockOnAdvancedAiPatch).toHaveBeenCalledWith({
      ollamaBaseUrl: 'http://localhost:11434',
      localBackendPreset: 'ollama_default',
    });
  });

  it('desktop: a classified test failure renders the translated key, not the raw technical message', async () => {
    setDesktopRuntime(true);
    vi.mocked(testAIConnection).mockResolvedValue({
      ok: false,
      error: 'Ollama HTTP 503',
      kind: 'httpError',
      params: { status: 503 },
    });
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    await waitFor(() => {
      // QNBS-v3: the translated text renders in two places (the status-badge error line and the
      // manual "Test connection" result span) — both share the same `testError` state.
      expect(screen.getAllByText('settings.ai.testError.httpError').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Ollama HTTP 503')).toBeNull();
  });

  it('desktop: an unexpected failure (no params) renders the translated key without crashing', async () => {
    setDesktopRuntime(true);
    vi.mocked(testAIConnection).mockResolvedValue({
      ok: false,
      error: 'TypeError: something internal broke at services/foo.ts:42',
      kind: 'unexpected',
    });
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByText('settings.ai.testError.unexpected').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/something internal broke/)).toBeNull();
  });
});
