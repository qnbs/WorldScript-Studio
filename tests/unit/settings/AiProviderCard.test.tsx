import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProviderCard } from '../../../components/settings/AiProviderCard';
import {
  listLocalBackendModels,
  scanLocalOpenAiCompatibleEndpoints,
  testAIConnection,
} from '../../../services/aiProviderService';
import { storageService } from '../../../services/storageService';

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
  listLocalBackendModels: vi.fn().mockResolvedValue([]),
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
// QNBS-v3: fixture for the grok-provider describe block below.
const grokAdvancedAi = { ...mockAdvancedAi, provider: 'grok' as const, model: 'grok-3' as const };

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
    // QNBS-v3: labels are translation keys now (t mock echoes the key) — was hardcoded literals
    expect(screen.getByText('settings.ai.provider.gemini')).toBeTruthy();
    expect(screen.getByText('settings.ai.provider.openai')).toBeTruthy();
    expect(screen.getByText('settings.ai.provider.ollama')).toBeTruthy();
    expect(screen.getByText('settings.ai.provider.anthropic')).toBeTruthy();
    expect(screen.getByText('settings.ai.provider.grok')).toBeTruthy();
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
    expect(listLocalBackendModels).not.toHaveBeenCalled();
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

  it('desktop: does not show the browser-only status for ollama before a user-triggered test', () => {
    setDesktopRuntime(true);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('settings.ai.providerStatusNotTested')).toBeTruthy();
    expect(screen.queryByText('settings.ai.providerStatusUnavailableBrowser')).toBeNull();
  });

  it('ignores stale connection-test results after switching to Ollama-in-browser mid-flight (CWE-209 race guard)', async () => {
    setDesktopRuntime(true);
    // Start a user-requested test, then ensure a provider-context switch invalidates its stale result.
    const resolvers: Array<(v: { ok: boolean }) => void> = [];
    vi.mocked(testAIConnection).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { rerender } = render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));
    await waitFor(() => expect(resolvers.length).toBeGreaterThan(0));

    // Switch to the browser before any in-flight request resolves — this must invalidate them all.
    setDesktopRuntime(false);
    rerender(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('settings.ai.providerStatusUnavailableBrowser')).toBeTruthy();
    });

    // Now resolve every stale (superseded) request with an error — none may surface.
    for (const resolve of resolvers) resolve({ ok: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('settings.ai.providerStatusUnavailableBrowser')).toBeTruthy();
    expect(screen.queryByText('settings.ai.providerStatusDisconnected')).toBeNull();
    expect(screen.queryByText(/testError/)).toBeNull();
  });

  it('desktop: does not probe models or localhost until the user requests it', () => {
    setDesktopRuntime(true);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    expect(listLocalBackendModels).not.toHaveBeenCalled();
    expect(testAIConnection).not.toHaveBeenCalled();
    expect(screen.queryByText('settings.ai.ollamaDesktopOnlyTitle')).toBeNull();
  });

  it('desktop: uses the LM Studio preset for the explicit model and connection diagnostics', async () => {
    setDesktopRuntime(true);
    vi.mocked(testAIConnection).mockResolvedValueOnce({
      ok: true,
      localServer: {
        normalizedEndpoint: 'http://127.0.0.1:1234/v1',
        transport: 'tauri-http',
        modelNames: ['local-model'],
      },
    });
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={{
          ...ollamaAdvancedAi,
          ollamaBaseUrl: 'http://localhost:1234',
          localBackendPreset: 'lm_studio',
        }}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'settings.ai.loadModels' }));
    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));

    await waitFor(() => {
      expect(listLocalBackendModels).toHaveBeenCalledWith('http://localhost:1234', 'lm_studio');
      expect(testAIConnection).toHaveBeenCalledWith(
        'ollama',
        expect.objectContaining({
          ollamaBaseUrl: 'http://localhost:1234',
          localBackendPreset: 'lm_studio',
        }),
      );
    });
    expect(screen.getByText('http://127.0.0.1:1234/v1')).toBeTruthy();
    expect(screen.getByText('settings.ai.localDiagnostic.tauriHttp')).toBeTruthy();
    expect(screen.getByText('local-model')).toBeTruthy();
  });

  it('PWA: labels an opted-in Ollama diagnostic with its browser transport', async () => {
    setDesktopRuntime(false);
    vi.mocked(testAIConnection).mockResolvedValueOnce({
      ok: true,
      localServer: {
        normalizedEndpoint: 'http://localhost:11434/api/tags',
        transport: 'browser-fetch',
        modelNames: ['browser-model'],
      },
    });
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
        browserOllamaEnabled
      />,
    );

    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));

    await waitFor(() => {
      expect(screen.getByText('http://localhost:11434/api/tags')).toBeTruthy();
    });
    expect(screen.getByText('settings.ai.localDiagnostic.browserFetch')).toBeTruthy();
    expect(screen.getByText('browser-model')).toBeTruthy();
  });

  it('never displays an in-flight diagnostic after the local backend context changes', async () => {
    setDesktopRuntime(true);
    let resolveTest: ((result: Awaited<ReturnType<typeof testAIConnection>>) => void) | null = null;
    vi.mocked(testAIConnection).mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<typeof testAIConnection>>>((resolve) => {
          resolveTest = resolve;
        }),
    );
    const user = userEvent.setup();
    const initialSettings = {
      ...ollamaAdvancedAi,
      ollamaBaseUrl: 'http://localhost:1234',
      localBackendPreset: 'lm_studio' as const,
    };
    const { rerender } = render(
      <AiProviderCard
        advancedAi={initialSettings}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));
    await waitFor(() => expect(resolveTest).not.toBeNull());

    rerender(
      <AiProviderCard
        advancedAi={{
          ...initialSettings,
          openAiCompatibleBaseUrl: 'http://localhost:9999/v1',
        }}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    if (!resolveTest) throw new Error('Connection test did not start');
    resolveTest({
      ok: true,
      localServer: {
        normalizedEndpoint: 'http://127.0.0.1:1234/v1',
        transport: 'tauri-http',
        modelNames: ['stale-model'],
      },
    });

    await waitFor(() => expect(screen.queryByText('stale-model')).toBeNull());
    expect(screen.queryByText('http://127.0.0.1:1234/v1')).toBeNull();
    expect(screen.getByText('settings.ai.providerStatusNotTested')).toBeTruthy();
  });

  it('clears a completed local diagnostic when its endpoint context changes', async () => {
    setDesktopRuntime(true);
    vi.mocked(testAIConnection).mockResolvedValueOnce({
      ok: true,
      localServer: {
        normalizedEndpoint: 'http://127.0.0.1:1234/v1',
        transport: 'tauri-http',
        modelNames: ['local-model'],
      },
    });
    const user = userEvent.setup();
    const { rerender } = render(
      <AiProviderCard
        advancedAi={{
          ...ollamaAdvancedAi,
          ollamaBaseUrl: 'http://localhost:1234',
          localBackendPreset: 'lm_studio',
        }}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));
    await waitFor(() => expect(screen.getByText('local-model')).toBeTruthy());

    rerender(
      <AiProviderCard
        advancedAi={{
          ...ollamaAdvancedAi,
          ollamaBaseUrl: 'http://localhost:8000',
          localBackendPreset: 'vllm',
        }}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );

    await waitFor(() => expect(screen.queryByText('local-model')).toBeNull());
    expect(screen.getByText('settings.ai.providerStatusNotTested')).toBeTruthy();
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

  it('desktop: a classified manual test failure renders the translated key, not the raw technical message', async () => {
    setDesktopRuntime(true);
    vi.mocked(testAIConnection).mockResolvedValue({
      ok: false,
      error: 'Ollama HTTP 503',
      kind: 'httpError',
      params: { status: 503 },
    });
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));
    await waitFor(() => {
      // QNBS-v3: the translated text renders in two places (the status-badge error line and the
      // manual "Test connection" result span) — both share the same `testError` state.
      expect(screen.getAllByText('settings.ai.testError.httpError').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Ollama HTTP 503')).toBeNull();
  });

  it('desktop: an unexpected manual test failure renders the translated key without crashing', async () => {
    setDesktopRuntime(true);
    vi.mocked(testAIConnection).mockResolvedValue({
      ok: false,
      error: 'TypeError: something internal broke at services/foo.ts:42',
      kind: 'unexpected',
    });
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));
    await waitFor(() => {
      expect(screen.getAllByText('settings.ai.testError.unexpected').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/something internal broke/)).toBeNull();
  });
});

// QNBS-v3 (ADR-0017): opt-in direct browser→Ollama connection — browserOllamaEnabled defaults to
// false in AiProviderCardProps, so every other test in this file (which never passes it) exercises
// the flag-off path unaffected.
describe('AiProviderCard — browser-Ollama opt-in (ADR-0017)', () => {
  it('web, flag off (default): still shows the desktop-only banner, no OLLAMA_ORIGINS command', () => {
    setDesktopRuntime(false);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('settings.ai.ollamaDesktopOnlyTitle')).toBeTruthy();
    expect(screen.queryByText('settings.ai.ollamaBrowserOptInTitle')).toBeNull();
  });

  it('web, flag on: shows the opt-in info block with the OLLAMA_ORIGINS command for the current origin', () => {
    setDesktopRuntime(false);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
        browserOllamaEnabled
      />,
    );
    expect(screen.getByText('settings.ai.ollamaBrowserOptInTitle')).toBeTruthy();
    expect(screen.queryByText('settings.ai.ollamaDesktopOnlyTitle')).toBeNull();
    expect(screen.getByText(`OLLAMA_ORIGINS=${window.location.origin} ollama serve`)).toBeTruthy();
  });

  it('web, flag on: probes models and tests the connection only after an explicit action', async () => {
    setDesktopRuntime(false);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
        browserOllamaEnabled
      />,
    );
    const user = userEvent.setup();
    expect(listLocalBackendModels).not.toHaveBeenCalled();
    expect(testAIConnection).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'settings.ai.loadModels' }));
    await user.click(screen.getByRole('button', { name: 'settings.ai.testConnection' }));
    await waitFor(() => {
      expect(listLocalBackendModels).toHaveBeenCalledWith(
        'http://localhost:11434',
        'ollama_default',
      );
      expect(testAIConnection).toHaveBeenCalledWith(
        'ollama',
        expect.objectContaining({ browserOllamaEnabled: true }),
      );
    });
  });

  it('web, flag on: Load Models and Test Connection buttons are enabled without background work', () => {
    setDesktopRuntime(false);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
        browserOllamaEnabled
      />,
    );
    expect(screen.getByRole('button', { name: 'settings.ai.loadModels' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.ai.testConnection' })).not.toBeDisabled();
  });

  it('desktop: unaffected by the flag — no opt-in info block, no change to the existing native-bypass note', () => {
    setDesktopRuntime(true);
    render(
      <AiProviderCard
        advancedAi={ollamaAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
        browserOllamaEnabled
      />,
    );
    expect(screen.getByText('settings.ai.ollamaTauriBypass')).toBeTruthy();
    expect(screen.queryByText('settings.ai.ollamaBrowserOptInTitle')).toBeNull();
  });
});

// QNBS-v3: covers the new grok key-input/model-selector UI added in Phase 1 (ADR-0016).
describe('AiProviderCard — grok provider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the API-key input and model selector for grok', async () => {
    render(
      <AiProviderCard
        advancedAi={grokAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByLabelText('settings.ai.grokKey')).toBeTruthy();
    // QNBS-v3: the Select renders only the currently-selected option's label when closed, so "Grok 3 Mini" isn't asserted here.
    await waitFor(() => {
      expect(screen.getByText('Grok 3')).toBeTruthy();
    });
  });

  it('saves the entered key via storageService.saveApiKey("grok", ...)', async () => {
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={grokAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    const input = screen.getByLabelText('settings.ai.grokKey');
    await user.type(input, 'xai-test-key');
    const saveButton = screen.getByText('settings.ai.save');
    await user.click(saveButton);
    await waitFor(() => {
      expect(storageService.saveApiKey).toHaveBeenCalledWith('grok', 'xai-test-key');
    });
  });
});

// QNBS-v3 (ADR-0016): desktop (Track A, native) and proxy-capable web (Track B, api/claude-proxy —
// Vercel/Cloudflare Pages) both render a real key input; only GitHub Pages (neither capability,
// static-only) keeps the CORS/proxy-unavailable warning block.
describe('AiProviderCard — anthropic provider (ADR-0016)', () => {
  const anthropicAdvancedAi = {
    ...mockAdvancedAi,
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5' as const,
  };
  const originalBaseUrl = import.meta.env.BASE_URL;

  afterEach(() => {
    setDesktopRuntime(false);
    import.meta.env.BASE_URL = originalBaseUrl;
  });

  it('GitHub Pages: shows the unavailable warning block, no key input', () => {
    setDesktopRuntime(false);
    import.meta.env.BASE_URL = '/WorldScript-Studio/';
    render(
      <AiProviderCard
        advancedAi={anthropicAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByText('settings.ai.corsRestriction')).toBeTruthy();
    expect(screen.queryByLabelText('settings.ai.anthropicKey')).toBeNull();
  });

  it('proxy-capable web: shows the real key input, model selector, and proxy note', () => {
    setDesktopRuntime(false);
    import.meta.env.BASE_URL = '/';
    render(
      <AiProviderCard
        advancedAi={anthropicAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByLabelText('settings.ai.anthropicKey')).toBeTruthy();
    expect(screen.getByText('Claude Haiku 4.5')).toBeTruthy();
    expect(screen.getByText('settings.ai.anthropicProxyNote')).toBeTruthy();
    expect(screen.queryByText('settings.ai.corsRestriction')).toBeNull();
  });

  it('proxy-capable web: saves the entered key via storageService.saveApiKey("anthropic", ...)', async () => {
    setDesktopRuntime(false);
    import.meta.env.BASE_URL = '/';
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={anthropicAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    const input = screen.getByLabelText('settings.ai.anthropicKey');
    await user.type(input, 'sk-ant-test-key');
    const saveButton = screen.getByText('settings.ai.save');
    await user.click(saveButton);
    await waitFor(() => {
      expect(storageService.saveApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test-key');
    });
  });

  it('desktop: shows the real key input and model selector, no warning block, no proxy note', () => {
    setDesktopRuntime(true);
    render(
      <AiProviderCard
        advancedAi={anthropicAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    expect(screen.getByLabelText('settings.ai.anthropicKey')).toBeTruthy();
    expect(screen.getByText('Claude Haiku 4.5')).toBeTruthy();
    expect(screen.queryByText('settings.ai.corsRestriction')).toBeNull();
    expect(screen.queryByText('settings.ai.anthropicProxyNote')).toBeNull();
  });

  it('desktop: saves the entered key via storageService.saveApiKey("anthropic", ...)', async () => {
    setDesktopRuntime(true);
    const user = userEvent.setup();
    render(
      <AiProviderCard
        advancedAi={anthropicAdvancedAi}
        onAdvancedAiPatch={mockOnAdvancedAiPatch}
        onProviderChange={mockOnProviderChange}
      />,
    );
    const input = screen.getByLabelText('settings.ai.anthropicKey');
    await user.type(input, 'sk-ant-test-key');
    const saveButton = screen.getByText('settings.ai.save');
    await user.click(saveButton);
    await waitFor(() => {
      expect(storageService.saveApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test-key');
    });
  });
});
