/**
 * Tests for components/settings/GpuMetricsPanel.tsx
 * QNBS-v3: Mocks deviceHealthService, gpuResourceManager, ecoModeService, feature flag.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockEnabled = true;
const mockDispatch = vi.fn();

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn(() => mockEnabled),
  useAppDispatch: vi.fn(() => mockDispatch),
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableAppHealthPanel: (s: unknown) => s,
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'en',
  }),
}));

let mockDeviceClass = 'high-end';
const mockGetHealthReport = vi.fn().mockResolvedValue({});
const mockGetDeviceClass = vi.fn(() => mockDeviceClass);

vi.mock('../../../services/ai/deviceHealthService', () => ({
  getHealthReport: (..._args: unknown[]) => mockGetHealthReport(),
  getDeviceClass: (..._args: unknown[]) => mockGetDeviceClass(),
}));

let mockQueueState = { current: null as string | null, queue: [] as string[] };
const mockGetQueueState = vi.fn(() => mockQueueState);

vi.mock('../../../services/ai/gpuResourceManager', () => ({
  gpuResourceManager: {
    getQueueState: (..._args: unknown[]) => mockGetQueueState(),
  },
}));

let mockIsEco = false;
const mockSetEcoModeExplicit = vi.fn();

vi.mock('../../../services/ai/ecoModeService', () => ({
  ecoModeService: {
    isEcoMode: () => mockIsEco,
    setEcoModeExplicit: (...args: unknown[]) => mockSetEcoModeExplicit(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GpuMetricsPanel } from '../../../components/settings/GpuMetricsPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GpuMetricsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnabled = true;
    mockDeviceClass = 'high-end';
    mockQueueState = { current: null, queue: [] };
    mockIsEco = false;
    mockGetHealthReport.mockResolvedValue({});
    mockGetDeviceClass.mockImplementation(() => mockDeviceClass);
    mockGetQueueState.mockImplementation(() => mockQueueState);
  });

  it('renders nothing when feature flag is disabled', () => {
    mockEnabled = false;
    const { container } = render(<GpuMetricsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders panel title when enabled', async () => {
    render(<GpuMetricsPanel />);
    await waitFor(() => expect(screen.getByText('settings.ai.gpu.panelTitle')).toBeInTheDocument());
  });

  it('renders high-end device class badge', async () => {
    mockDeviceClass = 'high-end';
    render(<GpuMetricsPanel />);
    await waitFor(() =>
      expect(screen.getByText('settings.ai.gpu.deviceHighEnd')).toBeInTheDocument(),
    );
  });

  it('renders mid-range device class badge', async () => {
    mockDeviceClass = 'mid-range';
    render(<GpuMetricsPanel />);
    await waitFor(() =>
      expect(screen.getByText('settings.ai.gpu.deviceMidRange')).toBeInTheDocument(),
    );
  });

  it('renders low-end device class badge', async () => {
    mockDeviceClass = 'low-end';
    render(<GpuMetricsPanel />);
    await waitFor(() =>
      expect(screen.getByText('settings.ai.gpu.deviceLowEnd')).toBeInTheDocument(),
    );
  });

  it('renders unknown device class badge', async () => {
    mockDeviceClass = 'unknown';
    render(<GpuMetricsPanel />);
    await waitFor(() =>
      expect(screen.getByText('settings.ai.gpu.deviceUnknown')).toBeInTheDocument(),
    );
  });

  it('shows em-dash when no current consumer', async () => {
    mockQueueState = { current: null, queue: [] };
    render(<GpuMetricsPanel />);
    await waitFor(() => {
      const dashes = screen.getAllByText('–');
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows current GPU consumer name', async () => {
    mockQueueState = { current: 'webllm', queue: [] };
    render(<GpuMetricsPanel />);
    await waitFor(() => expect(screen.getByText('webllm')).toBeInTheDocument());
  });

  it('shows waiting consumers when queue is not empty', async () => {
    mockQueueState = { current: 'webllm', queue: ['onnx', 'embedding'] };
    render(<GpuMetricsPanel />);
    await waitFor(() => expect(screen.getByText('onnx, embedding')).toBeInTheDocument());
  });

  it('renders eco mode toggle switch', async () => {
    render(<GpuMetricsPanel />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument());
  });

  it('eco mode switch is unchecked when eco is off', async () => {
    mockIsEco = false;
    render(<GpuMetricsPanel />);
    await waitFor(() => {
      const sw = screen.getByRole('switch');
      expect(sw).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('eco mode switch is checked when eco is on', async () => {
    mockIsEco = true;
    render(<GpuMetricsPanel />);
    await waitFor(() => {
      const sw = screen.getByRole('switch');
      expect(sw).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('dispatches setAiMode when toggle is clicked', async () => {
    const user = userEvent.setup();
    mockIsEco = false;
    render(<GpuMetricsPanel />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument());
    await user.click(screen.getByRole('switch'));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('calls getHealthReport on mount', async () => {
    render(<GpuMetricsPanel />);
    await waitFor(() => expect(mockGetHealthReport).toHaveBeenCalled());
  });
});
