/**
 * Tests for components/settings/AiExecutionModeSection.tsx
 * QNBS-v3: Verifies radiogroup semantics, mode selection dispatch + announce, keyboard arrow
 * navigation, and the dynamic per-mode capability hints (WebGPU absent / offline).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  announce: vi.fn(),
  setAiMode: vi.fn((m: string) => ({ type: 'settings/setAiMode', payload: m })),
  detectWebGpu: vi.fn(() => true),
  aiMode: 'hybrid' as string,
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ settings: { aiMode: mocks.aiMode } }),
}));

vi.mock('../../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => mocks.announce,
}));

vi.mock('../../../features/settings/settingsSlice', () => ({
  settingsActions: { setAiMode: (m: string) => mocks.setAiMode(m) },
}));

vi.mock('@domain/ai-core', () => ({
  detectWebGpuSupport: () => mocks.detectWebGpu(),
}));

import { AiExecutionModeSection } from '../../../components/settings/AiExecutionModeSection';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aiMode = 'hybrid';
  mocks.detectWebGpu.mockReturnValue(true);
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe('AiExecutionModeSection', () => {
  it('renders all four modes as radio options inside a radiogroup', () => {
    render(<AiExecutionModeSection />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByText('settings.aiMode.cloud')).toBeInTheDocument();
    expect(screen.getByText('settings.aiMode.local')).toBeInTheDocument();
    expect(screen.getByText('settings.aiMode.hybrid')).toBeInTheDocument();
    expect(screen.getByText('settings.aiMode.eco')).toBeInTheDocument();
  });

  it('marks the active mode as the checked radio', () => {
    mocks.aiMode = 'local';
    render(<AiExecutionModeSection />);
    const radios = screen.getAllByRole('radio'); // order: cloud, local, hybrid, eco
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it('groups all modes under one native radio name (free arrow-key navigation)', () => {
    render(<AiExecutionModeSection />);
    const radios = screen.getAllByRole('radio');
    expect(radios.every((r) => r.getAttribute('name') === 'ai-execution-mode')).toBe(true);
  });

  it('dispatches setAiMode and announces on click', async () => {
    const user = userEvent.setup();
    render(<AiExecutionModeSection />); // active = hybrid
    await user.click(screen.getByText('settings.aiMode.cloud'));
    expect(mocks.setAiMode).toHaveBeenCalledWith('cloud');
    expect(mocks.dispatch).toHaveBeenCalled();
    expect(mocks.announce).toHaveBeenCalledWith('settings.aiMode.activeLabel', 'polite');
  });

  it('does not re-dispatch when the active mode is clicked again', async () => {
    mocks.aiMode = 'cloud';
    const user = userEvent.setup();
    render(<AiExecutionModeSection />);
    await user.click(screen.getByText('settings.aiMode.cloud'));
    expect(mocks.setAiMode).not.toHaveBeenCalled();
  });

  it('selecting a mode via its radio dispatches setAiMode', async () => {
    mocks.aiMode = 'cloud';
    const user = userEvent.setup();
    render(<AiExecutionModeSection />);
    await user.click(screen.getByText('settings.aiMode.eco'));
    expect(mocks.setAiMode).toHaveBeenCalledWith('eco');
  });

  it('shows the WebGPU-missing hint for Local mode when WebGPU is unavailable', () => {
    mocks.aiMode = 'local';
    mocks.detectWebGpu.mockReturnValue(false);
    render(<AiExecutionModeSection />);
    expect(screen.getByText('settings.aiMode.hint.webgpuMissing')).toBeInTheDocument();
  });

  it('hides the WebGPU hint when WebGPU is available', () => {
    mocks.aiMode = 'local';
    mocks.detectWebGpu.mockReturnValue(true);
    render(<AiExecutionModeSection />);
    expect(screen.queryByText('settings.aiMode.hint.webgpuMissing')).not.toBeInTheDocument();
  });

  it('shows the cloud-offline hint when Cloud mode is active and offline', () => {
    mocks.aiMode = 'cloud';
    setOnline(false);
    render(<AiExecutionModeSection />);
    expect(screen.getByText('settings.aiMode.hint.cloudOffline')).toBeInTheDocument();
  });

  it('shows the hybrid-offline hint when Hybrid mode is active and offline', () => {
    mocks.aiMode = 'hybrid';
    setOnline(false);
    render(<AiExecutionModeSection />);
    expect(screen.getByText('settings.aiMode.hint.hybridOffline')).toBeInTheDocument();
  });
});
