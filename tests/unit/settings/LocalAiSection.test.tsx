/**
 * Tests for components/settings/LocalAiSection.tsx
 * QNBS-v3: Verifies capability rendering (WebGPU on/off), the model list + per-model storage size
 * warning, the Download → preload → ready-announce flow, the Clear-Local-Models confirm flow, and
 * the fallback-chain + throughput indicator. All services are mocked; the `t` mock returns the key.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  detectWebGpu: vi.fn(() => true),
  listCached: vi.fn(() => [] as { modelId: string }[]),
  estimate: vi.fn(),
  clear: vi.fn(),
  preload: vi.fn(),
  lastThroughput: vi.fn(
    () => null as null | { tokensPerSecond: number; modelId: string; at: number },
  ),
  healthReport: vi.fn(),
  modelRec: vi.fn(() => 'm-small'),
}));

const SUPPORTED_ESTIMATE = {
  usageMb: 100,
  quotaMb: 1000,
  freeMb: 600,
  usagePercent: 10,
  modelCacheCount: 1,
  supported: true,
};

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => mocks.announce,
}));
vi.mock('@domain/ai-core', () => ({
  detectWebGpuSupport: () => mocks.detectWebGpu(),
  listCachedWebLlmEngines: () => mocks.listCached(),
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
}));
vi.mock('../../../components/settings/LocalAiDownloadProgress', () => ({
  LocalAiDownloadProgress: () => null,
}));

import { LocalAiSection } from '../../../components/settings/LocalAiSection';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detectWebGpu.mockReturnValue(true);
  mocks.listCached.mockReturnValue([]);
  mocks.estimate.mockResolvedValue(SUPPORTED_ESTIMATE);
  mocks.clear.mockResolvedValue({ clearedCaches: 2 });
  mocks.preload.mockResolvedValue(true);
  mocks.lastThroughput.mockReturnValue(null);
  mocks.healthReport.mockResolvedValue({ deviceClass: 'mid-range', gpuVramTier: 'medium' });
  mocks.modelRec.mockReturnValue('m-small');
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
      usageMb: 0,
      quotaMb: 0,
      freeMb: 0,
      usagePercent: 0,
      modelCacheCount: 0,
      supported: false,
    });
    render(<LocalAiSection />);
    expect(await screen.findByText('settings.ai.localAi.storageUnsupported')).toBeInTheDocument();
    const clearBtn = screen.getByText('settings.ai.localAi.clearButton').closest('button');
    expect(clearBtn).toBeDisabled();
  });
});
