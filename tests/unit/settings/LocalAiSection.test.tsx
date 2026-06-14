/**
 * Tests for components/settings/LocalAiSection.tsx
 * QNBS-v3: Verifies capability rendering (WebGPU on/off), the model list + per-model storage size
 * warning, the Download → preload → ready-announce flow, the Clear-Local-Models confirm flow, and
 * the fallback-chain + throughput indicator. All services are mocked; the `t` mock returns the key.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inferenceProgressEmitter } from '../../../services/ai/inferenceProgressEmitter';

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  detectWebGpu: vi.fn(() => true),
  estimate: vi.fn(),
  clear: vi.fn(),
  preload: vi.fn(),
  lastThroughput: vi.fn(
    () => null as null | { tokensPerSecond: number; modelId: string; at: number },
  ),
  getReady: vi.fn(() => [] as string[]),
  clearReady: vi.fn(),
  abortPreload: vi.fn(),
  busy: vi.fn(() => false),
  healthReport: vi.fn(),
  modelRec: vi.fn(() => 'm-small'),
}));

const SUPPORTED_ESTIMATE = {
  usageMb: 100,
  quotaMb: 1000,
  freeMb: 600,
  usagePercent: 10,
  modelCacheCount: 1,
  estimateAvailable: true,
};

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => mocks.announce,
}));
vi.mock('@domain/ai-core', () => ({
  detectWebGpuSupport: () => mocks.detectWebGpu(),
  WEBLLM_SUPPORTED_MODELS: [
    { id: 'm-small', label: 'Small (~0.4 GB)' },
    { id: 'm-big', label: 'Big (~5 GB)' },
  ],
}));
vi.mock('../../../services/ai/deviceHealthService', () => ({
  getHealthReport: () => mocks.healthReport(),
  getModelRecommendation: () => mocks.modelRec(),
}));
vi.mock('../../../services/ai/localModelStorageService', () => ({
  estimateLocalModelStorage: () => mocks.estimate(),
  clearLocalModels: () => mocks.clear(),
  WEBLLM_MODEL_APPROX_MB: { 'm-small': 400, 'm-big': 5000 },
}));
vi.mock('../../../services/localAiFacade', () => ({
  preloadLocalModel: (id: string) => mocks.preload(id),
  getLastLocalThroughput: () => mocks.lastThroughput(),
  getReadyLocalModelIds: () => mocks.getReady(),
  clearReadyLocalModels: () => mocks.clearReady(),
  abortActivePreload: () => mocks.abortPreload(),
  isLocalAiBusy: () => mocks.busy(),
}));
vi.mock('../../../components/settings/LocalAiDownloadProgress', () => ({
  LocalAiDownloadProgress: () => null,
}));
vi.mock('../../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { LocalAiSection } from '../../../components/settings/LocalAiSection';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detectWebGpu.mockReturnValue(true);
  mocks.estimate.mockResolvedValue(SUPPORTED_ESTIMATE);
  mocks.clear.mockResolvedValue({ clearedCaches: 2 });
  mocks.preload.mockResolvedValue({ layer: 'webllm', modelId: 'm-small', downloaded: true });
  mocks.getReady.mockReturnValue([]);
  mocks.busy.mockReturnValue(false);
  mocks.lastThroughput.mockReturnValue(null);
  mocks.healthReport.mockResolvedValue({ deviceClass: 'mid-range', gpuVramTier: 'medium' });
  mocks.modelRec.mockReturnValue('m-small');
});

afterEach(() => {
  // QNBS-v3: the progress emitter is a singleton — reset so a "loading" state can't leak across tests.
  inferenceProgressEmitter.reset();
});

describe('LocalAiSection', () => {
  it('shows WebGPU as available and lists supported models', async () => {
    render(<LocalAiSection />);
    expect(await screen.findByText('settings.ai.localAi.webgpuAvailable')).toBeInTheDocument();
    expect(screen.getByText('Small (~0.4 GB)')).toBeInTheDocument();
    expect(screen.getByText('Big (~5 GB)')).toBeInTheDocument();
    expect(screen.getAllByText('settings.ai.localAi.downloadButton')).toHaveLength(2);
  });

  it('shows the WebGPU-unavailable state and the no-GPU note', async () => {
    mocks.detectWebGpu.mockReturnValue(false);
    render(<LocalAiSection />);
    expect(await screen.findByText('settings.ai.localAi.webgpuUnavailable')).toBeInTheDocument();
    expect(screen.getByText('settings.ai.localAi.requiresGpuNote')).toBeInTheDocument();
  });

  it('warns only for models larger than the free storage', async () => {
    render(<LocalAiSection />);
    // m-big (~5000 MB) > 600 MB free → exactly one warning; m-small (~400 MB) fits.
    await waitFor(() =>
      expect(screen.getAllByText('settings.ai.localAi.sizeWarning')).toHaveLength(1),
    );
  });

  it('downloads a model, then announces readiness and shows the Ready badge', async () => {
    const user = userEvent.setup();
    render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.webgpuAvailable');

    const downloadButtons = screen.getAllByText('settings.ai.localAi.downloadButton');
    await user.click(downloadButtons[0]!); // first model = m-small

    expect(mocks.preload).toHaveBeenCalledWith('m-small');
    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith(
        'settings.ai.localAi.modelReadyAnnounce',
        'polite',
      ),
    );
    expect(await screen.findByText('settings.ai.localAi.readyBadge')).toBeInTheDocument();
  });

  it('restores the Ready badge from the session source across an unmount/remount', async () => {
    const user = userEvent.setup();
    // First visit: nothing ready yet.
    mocks.getReady.mockReturnValue([]);
    const { unmount } = render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.webgpuAvailable');
    expect(screen.queryByText('settings.ai.localAi.readyBadge')).not.toBeInTheDocument();

    // Download m-small → it becomes ready in this session.
    await user.click(screen.getAllByText('settings.ai.localAi.downloadButton')[0]!);
    expect(await screen.findByText('settings.ai.localAi.readyBadge')).toBeInTheDocument();

    // The module-level session set now records it (what preloadLocalModel does in real code).
    mocks.getReady.mockReturnValue(['m-small']);

    // Navigate away (unmount) and back (fresh remount) — local React state is gone…
    unmount();
    expect(screen.queryByText('settings.ai.localAi.readyBadge')).not.toBeInTheDocument();
    render(<LocalAiSection />);

    // …but the badge is restored from the session source on the new mount.
    expect(await screen.findByText('settings.ai.localAi.readyBadge')).toBeInTheDocument();
  });

  it('surfaces a failure notification when a download throws (no unhandled rejection)', async () => {
    mocks.preload.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.webgpuAvailable');

    await user.click(screen.getAllByText('settings.ai.localAi.downloadButton')[0]!);
    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith('settings.ai.localAi.downloadFailed', 'polite'),
    );
    // downloadingId reset → buttons usable again, no Ready badge.
    expect(screen.queryByText('settings.ai.localAi.readyBadge')).not.toBeInTheDocument();
    expect(screen.getAllByText('settings.ai.localAi.downloadButton')[0]).not.toBeDisabled();
  });

  it('does NOT mark ready when preload falls back off WebLLM (e.g. no WebGPU)', async () => {
    mocks.detectWebGpu.mockReturnValue(false);
    mocks.preload.mockResolvedValue({ layer: 'onnx', modelId: 'm-small', downloaded: false });
    const user = userEvent.setup();
    render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.webgpuUnavailable');

    await user.click(screen.getAllByText('settings.ai.localAi.downloadButton')[0]!);
    expect(mocks.preload).toHaveBeenCalledWith('m-small');
    await waitFor(() => expect(mocks.preload).toHaveBeenCalled());
    // A non-WebLLM fallback is not a download of the requested model → no ready badge / announce.
    expect(screen.queryByText('settings.ai.localAi.readyBadge')).not.toBeInTheDocument();
    expect(mocks.announce).not.toHaveBeenCalledWith(
      'settings.ai.localAi.modelReadyAnnounce',
      'polite',
    );
  });

  it('clears local models through the confirm flow and announces the result', async () => {
    const user = userEvent.setup();
    render(<LocalAiSection />);
    // Wait until the storage estimate resolves so the Clear button is enabled.
    await screen.findByText('settings.ai.localAi.storageModelsCached');

    await user.click(screen.getByText('settings.ai.localAi.clearButton'));
    expect(screen.getByText('settings.ai.localAi.clearConfirm')).toBeInTheDocument();

    await user.click(screen.getByText('settings.ai.localAi.clearConfirmYes'));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith('settings.ai.localAi.clearedAnnounce', 'polite'),
    );
  });

  it('disables Clear while a download is in flight (no clear/download race)', async () => {
    let resolvePreload: (v: { layer: string; modelId: string; downloaded: boolean }) => void =
      () => {};
    mocks.preload.mockReturnValue(
      new Promise((res) => {
        resolvePreload = res;
      }),
    );
    const user = userEvent.setup();
    render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.storageModelsCached');

    const clearBtn = screen.getByText('settings.ai.localAi.clearButton').closest('button');
    expect(clearBtn).not.toBeDisabled();

    // Start (but don't finish) a download → Clear must lock out.
    await user.click(screen.getAllByText('settings.ai.localAi.downloadButton')[0]!);
    expect(clearBtn).toBeDisabled();

    // Settle to avoid act warnings.
    resolvePreload({ layer: 'webllm', modelId: 'm-small', downloaded: true });
    await waitFor(() => expect(clearBtn).not.toBeDisabled());
  });

  it('disables downloads while a WebLLM download runs elsewhere (externalLoading)', async () => {
    render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.webgpuAvailable');
    expect(screen.getAllByText('settings.ai.localAi.downloadButton')[0]).not.toBeDisabled();

    // A WebLLM download starts somewhere else (Copilot/ProForge) → emitter goes "loading".
    act(() => inferenceProgressEmitter.reportWebLlmProgress(0.3, 'loading'));
    await waitFor(() =>
      expect(screen.getAllByText('settings.ai.localAi.downloadButton')[0]).toBeDisabled(),
    );
  });

  it('refuses to clear and announces when local AI is busy app-wide', async () => {
    mocks.busy.mockReturnValue(true); // GPU held / download running elsewhere
    const user = userEvent.setup();
    render(<LocalAiSection />);
    await screen.findByText('settings.ai.localAi.storageModelsCached');

    await user.click(screen.getByText('settings.ai.localAi.clearButton'));
    await user.click(screen.getByText('settings.ai.localAi.clearConfirmYes'));

    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.announce).toHaveBeenCalledWith('settings.ai.localAi.clearBusy', 'polite');
  });

  it('renders the four-layer fallback chain and the no-data perf line by default', async () => {
    render(<LocalAiSection />);
    expect(await screen.findByText('settings.ai.localAi.fallbackLayer1')).toBeInTheDocument();
    expect(screen.getByText('settings.ai.localAi.fallbackLayer2')).toBeInTheDocument();
    expect(screen.getByText('settings.ai.localAi.fallbackLayer3')).toBeInTheDocument();
    expect(screen.getByText('settings.ai.localAi.fallbackLayer4')).toBeInTheDocument();
    expect(screen.getByText('settings.ai.localAi.perfNoData')).toBeInTheDocument();
  });

  it('shows last-run throughput when a sample exists', async () => {
    mocks.lastThroughput.mockReturnValue({ tokensPerSecond: 42, modelId: 'm-small', at: 0 });
    render(<LocalAiSection />);
    expect(await screen.findByText('settings.ai.localAi.perfThroughput')).toBeInTheDocument();
  });

  it('shows the unsupported message and disables Clear when storage estimates are unavailable', async () => {
    mocks.estimate.mockResolvedValue({
      usageMb: null,
      quotaMb: null,
      freeMb: null,
      usagePercent: null,
      modelCacheCount: 0,
      estimateAvailable: false,
    });
    render(<LocalAiSection />);
    expect(await screen.findByText('settings.ai.localAi.storageUnsupported')).toBeInTheDocument();
    const clearBtn = screen.getByText('settings.ai.localAi.clearButton').closest('button');
    expect(clearBtn).toBeDisabled();
  });
});
