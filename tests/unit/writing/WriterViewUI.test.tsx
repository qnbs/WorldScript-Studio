/**
 * Tests for components/writing/WriterViewUI.tsx
 * QNBS-v3: Mocks Redux hooks + sub-components; tests mobile tabs, version-control toggle,
 *          focus mode, ProForge toggle visibility (desktop + mobile), panel collapse.
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
    // QNBS-v3: reset first-use coachmark flags so badge/coachmark tests start from a clean slate.
    localStorage.clear();
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
    expect(screen.queryByTestId('writer-proforge-btn-desktop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('writer-proforge-btn-mobile')).not.toBeInTheDocument();
  });

  it('renders desktop ProForge toggle button when flag is enabled', () => {
    mockIsProForgeEnabled = true;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-desktop')).toBeInTheDocument();
  });

  it('renders mobile ProForge toggle button when flag is enabled', () => {
    mockIsProForgeEnabled = true;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-mobile')).toBeInTheDocument();
  });

  it('desktop ProForge button has correct aria-label when inactive', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = false;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-desktop')).toHaveAttribute(
      'aria-label',
      'proforge.toggle.activate',
    );
  });

  it('mobile ProForge button has correct aria-label when inactive', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = false;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-mobile')).toHaveAttribute(
      'aria-label',
      'proforge.toggle.activate',
    );
  });

  it('desktop ProForge button has deactivate label when active', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-desktop')).toHaveAttribute(
      'aria-label',
      'proforge.toggle.deactivate',
    );
  });

  it('mobile ProForge button has deactivate label when active', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-mobile')).toHaveAttribute(
      'aria-label',
      'proforge.toggle.deactivate',
    );
  });

  it('dispatches setProForgeActive when desktop ProForge button clicked', async () => {
    const user = userEvent.setup();
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = false;
    render(<WriterViewUI />);
    await user.click(screen.getByTestId('writer-proforge-btn-desktop'));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('dispatches setProForgeActive when mobile ProForge button clicked', async () => {
    const user = userEvent.setup();
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = false;
    render(<WriterViewUI />);
    await user.click(screen.getByTestId('writer-proforge-btn-mobile'));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('desktop ProForge button aria-pressed reflects active state', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-desktop')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('mobile ProForge button aria-pressed reflects active state', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    expect(screen.getByTestId('writer-proforge-btn-mobile')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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

  // -------------------------------------------------------------------------
  // Mode badge + restore-layout (Item 1)
  // -------------------------------------------------------------------------
  it('does not render the mode badge when no non-default modes are active', () => {
    render(<WriterViewUI />);
    expect(screen.queryByText('writer.modeBadge.label')).not.toBeInTheDocument();
  });

  it('renders the mode badge with a ProForge chip when ProForge is active', () => {
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    expect(screen.getByText('writer.modeBadge.label')).toBeInTheDocument();
    expect(screen.getByText('writer.modeBadge.proforge')).toBeInTheDocument();
  });

  it('restore-layout button turns ProForge off', async () => {
    const user = userEvent.setup();
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    await user.click(screen.getByTitle('writer.modeBadge.resetTitle'));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'proForge/setProForgeActive',
      payload: false,
    });
  });

  it('shows a Focus chip after enabling focus mode', async () => {
    const user = userEvent.setup();
    render(<WriterViewUI />);
    await user.click(screen.getByTitle('writer.focusMode.enter'));
    expect(screen.getByText('writer.modeBadge.focus')).toBeInTheDocument();
  });

  it('restore-layout also returns the mobile tab to the default (tools)', async () => {
    const user = userEvent.setup();
    // ProForge active → the mode badge (with the reset button) is rendered.
    mockIsProForgeEnabled = true;
    mockIsProForgeActive = true;
    render(<WriterViewUI />);
    await user.click(screen.getByTestId('writer-tab-context'));
    expect(screen.getByTestId('writer-tab-context')).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByTitle('writer.modeBadge.resetTitle'));
    expect(screen.getByTestId('writer-tab-tools')).toHaveAttribute('aria-selected', 'true');
  });
});
