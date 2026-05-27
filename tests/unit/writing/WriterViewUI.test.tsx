/**
 * Tests for components/writing/WriterViewUI.tsx
 * QNBS-v3: Mocks Redux hooks + sub-components; tests mobile tabs, version-control toggle,
 *          focus mode, ProForge toggle visibility, panel collapse.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockIsVCPanelOpen = false;
let mockIsProForgeEnabled = false;
let mockIsProForgeActive = false;

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      versionControl: { isPanelOpen: mockIsVCPanelOpen },
      featureFlags: { enableProForge: mockIsProForgeEnabled },
      proForge: { isActive: mockIsProForgeActive },
    }),
  ),
}));

vi.mock('../../../features/versionControl/versionControlSlice', () => ({
  selectIsPanelOpen: (s: { versionControl: { isPanelOpen: boolean } }) =>
    s.versionControl.isPanelOpen,
  versionControlActions: {
    togglePanel: vi.fn(() => ({ type: 'versionControl/togglePanel' })),
  },
}));

vi.mock('../../../features/proForge/proForgeSlice', () => ({
  proForgeActions: {
    setProForgeActive: vi.fn((v: boolean) => ({ type: 'proForge/setProForgeActive', payload: v })),
  },
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'en',
  }),
}));

vi.mock('../../../hooks/useSwipeGesture', () => ({
  useSwipeGesture: vi.fn(),
}));

vi.mock('../../../contexts/WriterViewContext', () => ({
  useWriterViewContext: vi.fn(() => ({
    flowMode: false,
    toggleFlowMode: vi.fn(),
  })),
}));

// Stub all child panels
vi.mock('../../../components/writing/ContextPanel', () => ({
  ContextPanel: () => <div data-testid="context-panel">Context</div>,
}));

vi.mock('../../../components/writing/ToolsPanel', () => ({
  ToolsPanel: () => <div data-testid="tools-panel">Tools</div>,
}));

vi.mock('../../../components/writing/AiScratchpad', () => ({
  AiScratchpad: () => <div data-testid="ai-scratchpad">Scratchpad</div>,
}));

vi.mock('../../../components/proForge/ProForgeDashboard', () => ({
  ProForgeDashboard: () => <div data-testid="proforge-dashboard">ProForge</div>,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { WriterViewUI } from '../../../components/writing/WriterViewUI';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WriterViewUI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVCPanelOpen = false;
    mockIsProForgeEnabled = false;
    mockIsProForgeActive = false;
  });

  it('renders mobile tab list', () => {
    render(<WriterViewUI />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders three mobile tabs', () => {
    render(<WriterViewUI />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);
  });

  it('tools tab is selected by default', () => {
    render(<WriterViewUI />);
    const toolsTab = screen.getByTestId('writer-tab-tools');
    expect(toolsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('renders version control button', () => {
    render(<WriterViewUI />);
    const vcBtn = screen.getAllByTestId('writer-version-control-btn');
    expect(vcBtn.length).toBeGreaterThan(0);
  });

  it('dispatches togglePanel when version control button clicked', async () => {
    const user = userEvent.setup();
    render(<WriterViewUI />);
    const vcBtn = screen.getAllByTestId('writer-version-control-btn')[0]!;
    await user.click(vcBtn);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('version control button aria-expanded is false when panel closed', () => {
    render(<WriterViewUI />);
    const vcBtn = screen.getAllByTestId('writer-version-control-btn')[0]!;
    expect(vcBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('version control button aria-expanded is true when panel open', () => {
    mockIsVCPanelOpen = true;
    render(<WriterViewUI />);
    const vcBtn = screen.getAllByTestId('writer-version-control-btn')[0]!;
    expect(vcBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not render ProForge toggle when flag is disabled', () => {
    mockIsProForgeEnabled = false;
    render(<WriterViewUI />);
    expect(screen.queryByText('ProForge')).not.toBeInTheDocument();
  });

  it('renders ProForge toggle button when flag is enabled', () => {
    mockIsProForgeEnabled = true;
    render(<WriterViewUI />);
    // The toggle button renders "ProForge" or "🔥 ProForge"
    expect(screen.getByRole('button', { name: /ProForge/ })).toBeInTheDocument();
  });

  it('dispatches setProForgeActive when ProForge button clicked', async () => {
    const user = userEvent.setup();
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = false;
    render(<WriterViewUI />);
    await user.click(screen.getByRole('button', { name: /ProForge/ }));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('switches to context tab when context tab clicked', async () => {
    const user = userEvent.setup();
    render(<WriterViewUI />);
    await user.click(screen.getByTestId('writer-tab-context'));
    expect(screen.getByTestId('writer-tab-context')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to result tab when result tab clicked', async () => {
    const user = userEvent.setup();
    render(<WriterViewUI />);
    await user.click(screen.getByTestId('writer-tab-result'));
    expect(screen.getByTestId('writer-tab-result')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders context and tools collapse buttons', () => {
    render(<WriterViewUI />);
    expect(screen.getByTitle('writer.context.hide')).toBeInTheDocument();
    expect(screen.getByTitle('writer.tools.hide')).toBeInTheDocument();
  });

  it('renders focus mode button', () => {
    render(<WriterViewUI />);
    expect(screen.getByTitle('writer.focusMode.enter')).toBeInTheDocument();
  });
});
