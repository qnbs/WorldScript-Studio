/**
 * LoraOnboarding tests — request-generation race guard, native error-category mapping
 * (lastError surfaced regardless of pythonAvailable), and select-Python button a11y.
 * QNBS-v3: regression coverage for the CodeRabbit/Codex/CodeAnt findings on this file.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoraOnboarding from '../../../components/lora/LoraOnboarding';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

const mockCheckTrainingEnvironment = vi.fn();
const mockSelectPythonExecutable = vi.fn();

vi.mock('../../../services/lora/loraTrainingService', () => ({
  checkTrainingEnvironment: (...args: unknown[]) => mockCheckTrainingEnvironment(...args),
  selectPythonExecutable: (...args: unknown[]) => mockSelectPythonExecutable(...args),
}));

interface DeferredEnv {
  pythonAvailable: boolean;
  unslothAvailable: boolean;
  cudaAvailable: boolean;
  vramGb: number;
  pythonVersion: string;
  pythonPath?: string;
  lastError?: string;
  message?: string;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseEnv: DeferredEnv = {
  pythonAvailable: false,
  unslothAvailable: false,
  cudaAvailable: false,
  vramGb: 0,
  pythonVersion: '',
};

describe('LoraOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the checking state, then renders the environment result', async () => {
    mockCheckTrainingEnvironment.mockResolvedValue({
      ...baseEnv,
      pythonAvailable: true,
      pythonVersion: '3.12.1',
    });
    render(<LoraOnboarding onDismiss={vi.fn()} />);
    expect(screen.getByText('lora.onboarding.checking')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/3\.12\.1/)).toBeInTheDocument());
  });

  it('ignores a stale initial check that resolves after a manual selection wins the race', async () => {
    const initial = deferred<DeferredEnv>();
    mockCheckTrainingEnvironment.mockReturnValue(initial.promise);
    mockSelectPythonExecutable.mockResolvedValue({
      ...baseEnv,
      pythonAvailable: true,
      pythonVersion: '3.13.0',
      pythonPath: '/usr/bin/python3.13',
    });

    render(<LoraOnboarding onDismiss={vi.fn()} />);
    await waitFor(() => expect(mockCheckTrainingEnvironment).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'lora.onboarding.selectPython' }));
    await waitFor(() => expect(screen.getByText(/3\.13\.0/)).toBeInTheDocument());

    // The slow initial check resolves late — it must not overwrite the newer manual-selection result.
    await act(async () => {
      initial.resolve({ ...baseEnv, pythonAvailable: true, pythonVersion: '3.9.0' });
      await initial.promise;
    });
    expect(screen.getByText(/3\.13\.0/)).toBeInTheDocument();
    expect(screen.queryByText(/3\.9\.0/)).not.toBeInTheDocument();
  });

  it('does not get stuck on "checking" forever when the file picker is cancelled mid-flight', async () => {
    // QNBS-v3: a cancelled picker resolves with null — it must not invalidate the still-pending
    // initial check, or the component never leaves the loading state.
    const initial = deferred<DeferredEnv>();
    mockCheckTrainingEnvironment.mockReturnValue(initial.promise);
    mockSelectPythonExecutable.mockResolvedValue(null);

    render(<LoraOnboarding onDismiss={vi.fn()} />);
    await waitFor(() => expect(mockCheckTrainingEnvironment).toHaveBeenCalled());
    expect(screen.getByText('lora.onboarding.checking')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'lora.onboarding.selectPython' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'lora.onboarding.selectPython' })).toBeEnabled(),
    );
    // Still checking — the cancelled picker applied no result.
    expect(screen.getByText('lora.onboarding.checking')).toBeInTheDocument();

    await act(async () => {
      initial.resolve({ ...baseEnv, pythonAvailable: true, pythonVersion: '3.12.1' });
      await initial.promise;
    });
    await waitFor(() => expect(screen.getByText(/3\.12\.1/)).toBeInTheDocument());
  });

  it('surfaces a translated native error even when pythonAvailable is true', async () => {
    mockCheckTrainingEnvironment.mockResolvedValue({
      ...baseEnv,
      pythonAvailable: true,
      pythonVersion: '3.12.1',
      lastError: 'helper_spawn_failed',
    });
    render(<LoraOnboarding onDismiss={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/lora\.onboarding\.error\.helperSpawnFailed/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/3\.12\.1/)).not.toBeInTheDocument();
  });

  it('falls back to the generic error key for an unmapped native category', async () => {
    mockCheckTrainingEnvironment.mockResolvedValue({ ...baseEnv });
    mockSelectPythonExecutable.mockRejectedValue(new Error('some_unmapped_category'));
    render(<LoraOnboarding onDismiss={vi.fn()} />);
    await waitFor(() => expect(mockCheckTrainingEnvironment).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'lora.onboarding.selectPython' }));
    await waitFor(() =>
      expect(screen.getByText(/lora\.onboarding\.error\.generic/)).toBeInTheDocument(),
    );
  });

  it('maps a known native error category and marks the button aria-busy while selecting', async () => {
    mockCheckTrainingEnvironment.mockResolvedValue({ ...baseEnv });
    const selecting = deferred<DeferredEnv>();
    mockSelectPythonExecutable.mockReturnValue(selecting.promise);
    render(<LoraOnboarding onDismiss={vi.fn()} />);
    await waitFor(() => expect(mockCheckTrainingEnvironment).toHaveBeenCalled());

    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'lora.onboarding.selectPython' });
    await user.click(button);

    expect(screen.getByRole('button', { name: 'lora.onboarding.selectingPython' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await act(async () => {
      selecting.resolve({
        ...baseEnv,
        pythonAvailable: false,
        lastError: 'configured_path_not_absolute',
      });
      await selecting.promise;
    });
    await waitFor(() =>
      expect(
        screen.getByText(/lora\.onboarding\.error\.configuredPathNotAbsolute/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'lora.onboarding.selectPython' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('calls onDismiss when Get Started is clicked', async () => {
    mockCheckTrainingEnvironment.mockResolvedValue({ ...baseEnv });
    const onDismiss = vi.fn();
    render(<LoraOnboarding onDismiss={onDismiss} />);
    await waitFor(() => expect(mockCheckTrainingEnvironment).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'lora.onboarding.getStarted' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
