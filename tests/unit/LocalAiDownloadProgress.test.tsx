/**
 * Tests for components/settings/LocalAiDownloadProgress.tsx
 * QNBS-v3: Mocks inferenceProgressEmitter + gpuResourceManager; tests progress modal visibility,
 *          progress bar, cancel button, error state.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockSnapshot = {
  state: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  progress: 0,
  estimatedSecondsRemaining: null as number | null,
  text: '',
  // QNBS-v3 (#333 item 1)
  loadedBytes: null as number | null,
  totalBytes: null as number | null,
  bytesPerSecond: null as number | null,
};
let capturedSubscriber: ((p: typeof mockSnapshot) => void) | null = null;

vi.mock('../../services/ai/inferenceProgressEmitter', () => ({
  inferenceProgressEmitter: {
    getWebLlmLoadingSnapshot: vi.fn(() => mockSnapshot),
    subscribeWebLlmLoading: vi.fn((cb: (p: typeof mockSnapshot) => void) => {
      capturedSubscriber = cb;
      return () => {
        capturedSubscriber = null;
      };
    }),
    reportWebLlmError: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('../../services/ai/gpuResourceManager', () => ({
  gpuResourceManager: {
    releaseGpu: vi.fn(),
  },
}));

const { mockAbortActivePreload, mockRetryLastPreload } = vi.hoisted(() => ({
  mockAbortActivePreload: vi.fn(),
  mockRetryLastPreload: vi.fn(),
}));

vi.mock('../../services/localAiFacade', () => ({
  abortActivePreload: mockAbortActivePreload,
  retryLastPreload: mockRetryLastPreload,
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    language: 'en',
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      value.toFixed(options?.maximumFractionDigits ?? 0),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { LocalAiDownloadProgress } from '../../components/settings/LocalAiDownloadProgress';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalAiDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshot = {
      state: 'idle',
      progress: 0,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    capturedSubscriber = null;
  });

  it('renders nothing when state is idle', () => {
    const { container } = render(<LocalAiDownloadProgress />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the progress modal when state is loading', () => {
    mockSnapshot = {
      state: 'loading',
      progress: 0.5,
      estimatedSecondsRemaining: 30,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders cancel button when loading', () => {
    mockSnapshot = {
      state: 'loading',
      progress: 0.3,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    expect(screen.getByText('settings.ai.localAi.cancelButton')).toBeInTheDocument();
  });

  it('shows progress percentage in aria-valuenow', () => {
    mockSnapshot = {
      state: 'loading',
      progress: 0.75,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '75');
  });

  it('renders error state when state is error', () => {
    mockSnapshot = {
      state: 'error',
      progress: 0,
      estimatedSecondsRemaining: null,
      text: 'Download failed',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    expect(screen.getByText('Download failed')).toBeInTheDocument();
  });

  it('calls releaseGpu when cancel is clicked', async () => {
    const { gpuResourceManager } = await import('../../services/ai/gpuResourceManager');
    const user = userEvent.setup();
    mockSnapshot = {
      state: 'loading',
      progress: 0.2,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    await user.click(screen.getByText('settings.ai.localAi.cancelButton'));
    expect(gpuResourceManager.releaseGpu).toHaveBeenCalledWith('webllm');
    expect(mockAbortActivePreload).toHaveBeenCalledTimes(1);
  });

  it('retries the actual prior preload after an error', async () => {
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const user = userEvent.setup();
    mockSnapshot = {
      state: 'error',
      progress: 0.2,
      estimatedSecondsRemaining: null,
      text: 'Download failed',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    mockRetryLastPreload.mockResolvedValue(undefined);
    render(<LocalAiDownloadProgress />);

    await user.click(screen.getByText('settings.ai.localAi.retryButton'));
    expect(inferenceProgressEmitter.reset).toHaveBeenCalledTimes(1);
    expect(mockRetryLastPreload).toHaveBeenCalledTimes(1);
  });

  it('surfaces retry failures via reportWebLlmError when retryLastPreload rejects', async () => {
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const user = userEvent.setup();
    mockSnapshot = {
      state: 'error',
      progress: 0.2,
      estimatedSecondsRemaining: null,
      text: 'Download failed',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    const retryError = new Error('No local model download is available to retry');
    mockRetryLastPreload.mockRejectedValueOnce(retryError);
    render(<LocalAiDownloadProgress />);

    await user.click(screen.getByText('settings.ai.localAi.retryButton'));

    expect(mockRetryLastPreload).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(inferenceProgressEmitter.reportWebLlmError).toHaveBeenCalledWith(retryError.message),
    );
  });

  it('updates progress when subscriber fires', async () => {
    mockSnapshot = {
      state: 'idle',
      progress: 0,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    // Simulate progress update
    if (capturedSubscriber) {
      capturedSubscriber({
        state: 'loading',
        progress: 0.6,
        estimatedSecondsRemaining: null,
        text: '',
        loadedBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
      });
    }
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
  });

  it('shows loaded/total MB and speed once the snapshot has byte metrics', () => {
    mockSnapshot = {
      state: 'loading',
      progress: 0.5,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: 350 * 1024 * 1024,
      totalBytes: 700 * 1024 * 1024,
      bytesPerSecond: 3.2 * 1024 * 1024,
    };
    render(<LocalAiDownloadProgress />);
    expect(
      screen.getByText('settings.ai.localAi.downloadSize:{"loaded":"~350","total":"~700"}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('settings.ai.localAi.downloadSpeed:{"speed":"~3.2"}'),
    ).toBeInTheDocument();
  });

  it('shows no size/speed text when the snapshot has no byte metrics', () => {
    mockSnapshot = {
      state: 'loading',
      progress: 0.5,
      estimatedSecondsRemaining: null,
      text: '',
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    render(<LocalAiDownloadProgress />);
    expect(screen.queryByText(/downloadSize/)).not.toBeInTheDocument();
    expect(screen.queryByText(/downloadSpeed/)).not.toBeInTheDocument();
  });
});
