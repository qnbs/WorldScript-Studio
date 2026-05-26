/**
 * Tests for components/settings/ProjectAiPresetSection.tsx
 * QNBS-v3: Mocks SettingsViewContext + Redux; tests enable toggle, provider/model selectors, reset.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockPreset: Record<string, unknown> | null = null;

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: vi.fn((selector: (s: any) => unknown) =>
    selector({
      project: {
        present: {
          data: {
            id: 'proj1',
            aiPreset: mockPreset,
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            manuscript: [],
          },
        },
      },
      settings: {
        present: {
          advancedAi: {
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            temperature: 0.7,
            maxTokens: 2048,
          },
          aiCreativity: 'Balanced',
        },
      },
    }),
  ),
}));

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectAiPreset: (state: Record<string, unknown>) => {
    const project = state['project'] as { present: { data: { aiPreset: unknown } } } | undefined;
    return project?.present?.data?.aiPreset ?? null;
  },
  selectEffectiveAiOptions: () => ({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    maxTokens: 2048,
  }),
}));

vi.mock('../../../features/project/projectSlice', () => ({
  projectActions: {
    patchProjectAiPreset: vi.fn((p: unknown) => ({
      type: 'project/patchProjectAiPreset',
      payload: p,
    })),
    clearProjectAiPreset: vi.fn(() => ({ type: 'project/clearProjectAiPreset' })),
  },
}));

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((p: unknown) => ({ type: 'status/addNotification', payload: p })),
  },
}));

vi.mock('@domain/ai-core', () => ({
  WEBLLM_SUPPORTED_MODELS: [{ id: 'Llama-3.2-1B-q4f32_1-MLC', label: 'Llama 3.2 1B' }],
  ONNX_SUPPORTED_MODELS: [{ id: 'Xenova/distilgpt2', label: 'DistilGPT-2' }],
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({ children, value, onChange, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
      <select value={value} onChange={onChange} {...rest}>
        {children}
      </select>
    ),
  ),
}));

vi.mock('../../../components/ui/Input', () => ({
  Input: vi.fn(({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} {...rest} />
  )),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { ProjectAiPresetSection } from '../../../components/settings/ProjectAiPresetSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectAiPresetSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreset = null;
  });

  it('renders the section title', () => {
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.title')).toBeInTheDocument();
  });

  it('renders the description text', () => {
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.description')).toBeInTheDocument();
  });

  it('renders the enable toggle', () => {
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.enableToggle')).toBeInTheDocument();
  });

  it('does not show override fields when disabled (no preset)', () => {
    render(<ProjectAiPresetSection />);
    expect(screen.queryByText('settings.projectAi.provider')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.projectAi.model')).not.toBeInTheDocument();
  });

  it('shows override fields when preset is enabled', () => {
    mockPreset = { enabled: true, provider: 'gemini', model: 'gemini-2.5-flash' };
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.provider')).toBeInTheDocument();
    expect(screen.getByText('settings.projectAi.model')).toBeInTheDocument();
  });

  it('shows active indicator badge when preset is enabled', () => {
    mockPreset = { enabled: true };
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.activeIndicator')).toBeInTheDocument();
  });

  it('does not show active indicator when preset is disabled', () => {
    render(<ProjectAiPresetSection />);
    expect(screen.queryByText('settings.projectAi.activeIndicator')).not.toBeInTheDocument();
  });

  it('dispatches patchProjectAiPreset when toggle is clicked', async () => {
    const { projectActions } = await import('../../../features/project/projectSlice');
    const user = userEvent.setup();
    render(<ProjectAiPresetSection />);
    await user.click(screen.getByRole('switch', { name: 'settings.projectAi.enableToggle' }));
    expect(projectActions.patchProjectAiPreset).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('shows reset button when preset is enabled', () => {
    mockPreset = { enabled: true };
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.reset')).toBeInTheDocument();
  });

  it('dispatches clearProjectAiPreset when reset is clicked', async () => {
    const { projectActions } = await import('../../../features/project/projectSlice');
    const user = userEvent.setup();
    mockPreset = { enabled: true };
    render(<ProjectAiPresetSection />);
    await user.click(screen.getByText('settings.projectAi.reset'));
    expect(projectActions.clearProjectAiPreset).toHaveBeenCalled();
  });

  it('shows creativity selector when preset is enabled', () => {
    mockPreset = { enabled: true };
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.creativity')).toBeInTheDocument();
  });

  it('shows temperature slider when preset is enabled', () => {
    mockPreset = { enabled: true };
    render(<ProjectAiPresetSection />);
    expect(screen.getByText('settings.projectAi.temperature')).toBeInTheDocument();
  });
});
