/**
 * Tests for components/settings/OpenRouterSection.tsx
 * QNBS-v3: Verifies toggle, key save/remove/test, model selection, custom model commit,
 * circuit reset, and cloud AI policy gating.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (available inside vi.mock factories)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  fetchModels: vi.fn().mockResolvedValue([]),
  validateKey: vi.fn().mockResolvedValue({ ok: true }),
  clearCache: vi.fn(),
  resetCircuit: vi.fn(),
  isCircuitOpen: vi.fn().mockReturnValue(false),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
  saveApiKey: vi.fn().mockResolvedValue(undefined),
  clearApiKey: vi.fn().mockResolvedValue(undefined),
  getApiKey: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({
      settings: {
        openRouter: { enabled: false, preferredModel: 'deepseek/deepseek-r1:free' },
        aiMode: 'cloud',
      },
    }),
}));

vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowed: (...args: unknown[]) => mocks.assertCloudAiAllowed(...args),
}));

vi.mock('../../../services/ai/openrouterModels', () => ({
  clearOpenRouterModelCache: mocks.clearCache,
  fetchOpenRouterModels: (...args: unknown[]) => mocks.fetchModels(...args),
  getOpenRouterModelCatalog: (...args: unknown[]) => mocks.fetchModels(...args),
  isOpenRouterFreeModel: (id: string) => id.endsWith(':free'),
  validateOpenRouterKey: (...args: unknown[]) => mocks.validateKey(...args),
}));

vi.mock('../../../services/ai/providers/openrouterProvider', () => ({
  getApproxRpm: () => 0,
  isCircuitOpen: () => mocks.isCircuitOpen(),
  OPENROUTER_FREE_MODELS: [
    'deepseek/deepseek-r1:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen2.5-72b-instruct:free',
    'google/gemma-3-27b-it:free',
    'mistralai/mistral-7b-instruct:free',
  ],
  resetOpenRouterCircuit: mocks.resetCircuit,
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    getApiKey: (...args: unknown[]) => mocks.getApiKey(...args),
    saveApiKey: (...args: unknown[]) => mocks.saveApiKey(...args),
    clearApiKey: (...args: unknown[]) => mocks.clearApiKey(...args),
  },
}));

vi.mock('../../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((p: unknown) => ({ type: 'status/addNotification', payload: p })),
  },
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      value,
      onChange,
      options,
      groups,
      ariaLabel,
      // QNBS-v3: Drop design-system-only props that do not exist on a native <select>.
      searchable: _searchable,
      searchPlaceholder: _searchPlaceholder,
      ...rest
    }: {
      value: string;
      onChange: (v: string) => void;
      options?: Array<{ value: string; label: string; disabled?: boolean }>;
      groups?: Array<{
        label: string;
        options: Array<{ value: string; label: string; disabled?: boolean }>;
      }>;
      ariaLabel?: string;
      searchable?: boolean;
      searchPlaceholder?: string;
      [key: string]: unknown;
    }) => (
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      >
        {(options ?? groups?.flatMap((g) => g.options) ?? []).map(
          (opt: { value: string; label: string; disabled?: boolean }) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    ),
  ),
}));

vi.mock('../../../components/ui/Input', () => ({
  Input: vi.fn(({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} {...rest} />
  )),
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: vi.fn(
    ({ children, onClick, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button onClick={onClick} disabled={disabled} {...rest}>
        {children}
      </button>
    ),
  ),
}));

vi.mock('../../../components/ui/Spinner', () => ({
  Spinner: vi.fn(({ className }: { className?: string }) => <span className={className} />),
}));

vi.mock('../../../components/ui/Card', () => ({
  Card: vi.fn(({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  )),
  CardContent: vi.fn(({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  )),
  CardHeader: vi.fn(({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  )),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { OpenRouterSection } from '../../../components/settings/OpenRouterSection';
import { settingsActions } from '../../../features/settings/settingsSlice';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenRouterSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.dispatch.mockImplementation(() => undefined);
    mocks.fetchModels.mockResolvedValue([]);
    mocks.validateKey.mockResolvedValue({ ok: true });
    mocks.assertCloudAiAllowed.mockResolvedValue(undefined);
    mocks.saveApiKey.mockResolvedValue(undefined);
    mocks.clearApiKey.mockResolvedValue(undefined);
    mocks.getApiKey.mockResolvedValue(null);
    mocks.clearCache.mockImplementation(() => undefined);
    mocks.resetCircuit.mockImplementation(() => undefined);
    mocks.isCircuitOpen.mockReturnValue(false);
  });

  it('renders title, toggle, key input and model selector', async () => {
    render(<OpenRouterSection />);
    expect(screen.getByText('settings.openRouter.title')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('settings.openRouter.apiKeyPlaceholder'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('settings.openRouter.modelAriaLabel')).toBeInTheDocument(),
    );
  });

  it('toggle dispatches setOpenRouter({ enabled })', async () => {
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    expect(mocks.dispatch).toHaveBeenCalledWith(settingsActions.setOpenRouter({ enabled: true }));
  });

  it('saves API key via storageService and clears cache', async () => {
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    const input = screen.getByPlaceholderText('settings.openRouter.apiKeyPlaceholder');
    await user.type(input, 'sk-or-v1-test');
    await user.click(screen.getByText('settings.openRouter.saveKey'));
    await waitFor(() => {
      expect(mocks.saveApiKey).toHaveBeenCalledWith('openrouter', 'sk-or-v1-test');
      expect(mocks.clearCache).toHaveBeenCalled();
    });
  });

  it('shows remove key button only when a key is stored', async () => {
    mocks.getApiKey.mockResolvedValue('stored-key');
    render(<OpenRouterSection />);
    await waitFor(() =>
      expect(screen.getByText('settings.openRouter.clearKey')).toBeInTheDocument(),
    );
  });

  it('remove key calls storageService.clearApiKey and clearOpenRouterModelCache', async () => {
    mocks.getApiKey.mockResolvedValue('stored-key');
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    const removeBtn = await waitFor(() => screen.getByText('settings.openRouter.clearKey'));
    await user.click(removeBtn);
    await waitFor(() => {
      expect(mocks.clearApiKey).toHaveBeenCalledWith('openrouter');
      expect(mocks.clearCache).toHaveBeenCalled();
    });
  });

  it('model selection dispatches setOpenRouter({ preferredModel })', async () => {
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    const select = await waitFor(() => screen.getByLabelText('settings.openRouter.modelAriaLabel'));
    await user.selectOptions(select, 'qwen/qwen2.5-72b-instruct:free');
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        settingsActions.setOpenRouter({ preferredModel: 'qwen/qwen2.5-72b-instruct:free' }),
      ),
    );
  });

  it('custom model input commits on blur and Enter', async () => {
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    const select = await waitFor(() => screen.getByLabelText('settings.openRouter.modelAriaLabel'));
    await user.selectOptions(select, '__custom__');

    const customInput = screen.getByLabelText('settings.openRouter.customModelAriaLabel');

    // Blur path: typing then tabbing away commits the value.
    await user.type(customInput, 'custom/model-id');
    await user.tab();
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        settingsActions.setOpenRouter({ preferredModel: 'custom/model-id' }),
      ),
    );

    // Enter path: re-enter a different value and press Enter — covers the keydown commit branch.
    mocks.dispatch.mockClear();
    await user.clear(customInput);
    await user.type(customInput, 'enter/model-id{Enter}');
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        settingsActions.setOpenRouter({ preferredModel: 'enter/model-id' }),
      ),
    );
  });

  it('reverts the custom selection when the custom input is left empty', async () => {
    // QNBS-v3: Selecting custom then leaving it empty must not persist anything AND must not leave
    // "custom" selected while the stored (free) model is unchanged — the UI reverts to the real model.
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    const select = await waitFor(() => screen.getByLabelText('settings.openRouter.modelAriaLabel'));
    await user.selectOptions(select, '__custom__');
    const customInput = screen.getByLabelText('settings.openRouter.customModelAriaLabel');

    mocks.dispatch.mockClear();
    await user.click(customInput);
    await user.tab(); // blur with an empty custom value

    expect(mocks.dispatch).not.toHaveBeenCalled();
    // Selection reverted to the configured free model → custom input no longer shown.
    await waitFor(() =>
      expect(
        screen.queryByLabelText('settings.openRouter.customModelAriaLabel'),
      ).not.toBeInTheDocument(),
    );
  });

  it('test connection validates the stored key', async () => {
    mocks.getApiKey.mockResolvedValue('stored-key');
    const user = userEvent.setup();
    render(<OpenRouterSection />);
    // QNBS-v3: Wait for the async key load to enable the button (storedKey set + isKeyLoading false),
    // not just for getApiKey to be invoked — otherwise the click can land while it's still disabled.
    const testBtn = await screen.findByRole('button', {
      name: 'settings.openRouter.testConnection',
    });
    await waitFor(() => expect(testBtn).toBeEnabled());
    // QNBS-v3: assertCloudAiAllowed also runs during the mount catalog effect; clear its call history
    // so the assertions below prove the *click* performed the policy check + key validation, not mount.
    mocks.assertCloudAiAllowed.mockClear();
    await user.click(testBtn);
    await waitFor(() => {
      expect(mocks.assertCloudAiAllowed).toHaveBeenCalledWith('openrouter');
      expect(mocks.validateKey).toHaveBeenCalledWith('stored-key');
    });
  });

  it('shows policy-blocked message when cloud AI is disallowed', async () => {
    mocks.assertCloudAiAllowed.mockRejectedValue(new Error('blocked'));
    render(<OpenRouterSection />);
    await waitFor(() =>
      expect(screen.getByText('settings.openRouter.policyBlocked')).toBeInTheDocument(),
    );
  });

  it('circuit reset calls resetOpenRouterCircuit', async () => {
    mocks.isCircuitOpen.mockReturnValue(true);
    render(<OpenRouterSection />);
    const resetBtn = await waitFor(() => screen.getByText('settings.openRouter.resetCircuit'));
    const user = userEvent.setup();
    await user.click(resetBtn);
    expect(mocks.resetCircuit).toHaveBeenCalled();
  });
});
