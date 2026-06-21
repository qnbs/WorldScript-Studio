/**
 * Tests for components/settings/OllamaDevicePull.tsx — device-aware Ollama recommendation + one-click
 * pull. Mocks the device profiler, the recommendation mapper, and pullOllamaModel.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetHealthReport, mockGetOllamaModelForDevice, mockPull } = vi.hoisted(() => ({
  mockGetHealthReport: vi.fn(),
  mockGetOllamaModelForDevice: vi.fn(),
  mockPull: vi.fn(),
}));

vi.mock('../../../services/ai/deviceHealthService', () => ({
  getHealthReport: mockGetHealthReport,
}));
vi.mock('../../../services/ai/modelRecommendations', () => ({
  getOllamaModelForDevice: mockGetOllamaModelForDevice,
}));
vi.mock('../../../services/ollamaService', () => ({ pullOllamaModel: mockPull }));
vi.mock('../../../services/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { OllamaDevicePull } from '../../../components/settings/OllamaDevicePull';

const t = ((k: string) => k) as never;

function setRec(over: Record<string, unknown> = {}) {
  mockGetOllamaModelForDevice.mockReturnValue({
    modelId: 'llama3.2:3b',
    tier: 'mid-range',
    sizeHint: '~2.0 GB',
    downgradedForBattery: false,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHealthReport.mockResolvedValue({ deviceClass: 'mid-range' });
  setRec();
  mockPull.mockResolvedValue(undefined);
});

describe('OllamaDevicePull', () => {
  it('renders the device recommendation after profiling', async () => {
    render(<OllamaDevicePull baseUrl="http://localhost:11434" onUseModel={vi.fn()} t={t} />);
    expect(await screen.findByText('llama3.2:3b')).toBeInTheDocument();
    expect(screen.getByText('~2.0 GB')).toBeInTheDocument();
    expect(screen.getByText('settings.advancedAi.ollamaPull.tier.mid-range')).toBeInTheDocument();
  });

  it('pulls the model and, on success, applies it via onUseModel', async () => {
    const onUseModel = vi.fn();
    const user = userEvent.setup();
    render(<OllamaDevicePull baseUrl="http://localhost:11434" onUseModel={onUseModel} t={t} />);
    await user.click(
      await screen.findByRole('button', { name: 'settings.advancedAi.ollamaPull.pull' }),
    );
    expect(mockPull).toHaveBeenCalledWith(
      'llama3.2:3b',
      expect.objectContaining({ baseUrl: 'http://localhost:11434' }),
    );
    const useBtn = await screen.findByRole('button', {
      name: 'settings.advancedAi.ollamaPull.useModel',
    });
    await user.click(useBtn);
    expect(onUseModel).toHaveBeenCalledWith('ollama/llama3.2:3b');
  });

  it('surfaces an error and offers retry when the pull fails', async () => {
    mockPull.mockRejectedValueOnce(new Error('Ollama not reachable (…)'));
    const user = userEvent.setup();
    render(<OllamaDevicePull baseUrl="http://localhost:11434" onUseModel={vi.fn()} t={t} />);
    await user.click(
      await screen.findByRole('button', { name: 'settings.advancedAi.ollamaPull.pull' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('not reachable');
    expect(
      screen.getByRole('button', { name: 'settings.advancedAi.ollamaPull.retry' }),
    ).toBeInTheDocument();
  });

  it('cancels via the Cancel button (aborts the controller) and returns to idle', async () => {
    // The mocked pull observes the AbortSignal and rejects with AbortError when it fires — so this
    // exercises the REAL Cancel wiring (onClick → abortRef.abort() → signal). Broken wiring (onClick
    // not aborting) would leave the pull pending and the idle Pull button would never return.
    mockPull.mockImplementationOnce(
      (_name: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const user = userEvent.setup();
    render(<OllamaDevicePull baseUrl="http://localhost:11434" onUseModel={vi.fn()} t={t} />);
    await user.click(
      await screen.findByRole('button', { name: 'settings.advancedAi.ollamaPull.pull' }),
    );
    // pull is in flight → click the real Cancel button
    await user.click(await screen.findByRole('button', { name: 'common.cancel' }));

    // definitive transition: the idle Pull button returns (findBy waits) and no error alert appears
    expect(
      await screen.findByRole('button', { name: 'settings.advancedAi.ollamaPull.pull' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the battery-downgrade note when the tier was stepped down', async () => {
    setRec({ downgradedForBattery: true });
    render(<OllamaDevicePull baseUrl="http://localhost:11434" onUseModel={vi.fn()} t={t} />);
    expect(
      await screen.findByText('settings.advancedAi.ollamaPull.batteryNote'),
    ).toBeInTheDocument();
  });
});
