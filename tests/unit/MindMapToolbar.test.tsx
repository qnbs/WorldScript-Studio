/**
 * Tests for components/mind-map/MindMapToolbar.tsx
 * QNBS-v3: Mocks MindMapViewContext and translation.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleZoom = vi.fn();
const mockHandleResetViewport = vi.fn();
let mockZoom = 1.0;

vi.mock('../../contexts/MindMapViewContext', () => ({
  useMindMapViewContext: () => ({
    zoom: mockZoom,
    handleZoom: mockHandleZoom,
    handleResetViewport: mockHandleResetViewport,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MindMapToolbar } from '../../components/mind-map/MindMapToolbar';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindMapToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZoom = 1.0;
  });

  it('renders zoom in button', () => {
    render(<MindMapToolbar />);
    expect(screen.getByRole('button', { name: 'mindmap.zoomIn' })).toBeInTheDocument();
  });

  it('renders zoom out button', () => {
    render(<MindMapToolbar />);
    expect(screen.getByRole('button', { name: 'mindmap.zoomOut' })).toBeInTheDocument();
  });

  it('renders reset viewport button', () => {
    render(<MindMapToolbar />);
    expect(screen.getByRole('button', { name: 'mindmap.resetViewport' })).toBeInTheDocument();
  });

  it('shows zoom percentage label', () => {
    mockZoom = 1.5;
    render(<MindMapToolbar />);
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('calls handleZoom(0.1) when zoom in clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapToolbar />);
    await user.click(screen.getByRole('button', { name: 'mindmap.zoomIn' }));
    expect(mockHandleZoom).toHaveBeenCalledWith(0.1);
  });

  it('calls handleZoom(-0.1) when zoom out clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapToolbar />);
    await user.click(screen.getByRole('button', { name: 'mindmap.zoomOut' }));
    expect(mockHandleZoom).toHaveBeenCalledWith(-0.1);
  });

  it('calls handleResetViewport when reset button clicked', async () => {
    const user = userEvent.setup();
    render(<MindMapToolbar />);
    await user.click(screen.getByRole('button', { name: 'mindmap.resetViewport' }));
    expect(mockHandleResetViewport).toHaveBeenCalledTimes(1);
  });
});
