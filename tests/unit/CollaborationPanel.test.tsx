import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollaborationPanel } from '../../components/CollaborationPanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/collaborationService', () => ({
  collaborationService: {
    getConnectedUsers: vi.fn(() => []),
    isConnected: false,
    onUsersChange: vi.fn(() => () => undefined),
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendCursorPosition: vi.fn(),
  },
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        collaboration: {
          webrtcSignalingUrls: ['wss://signaling.example.com'],
        },
      },
    }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

const mockOnClose = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollaborationPanel', () => {
  it('renders without throwing when closed', () => {
    expect(() =>
      render(<CollaborationPanel isOpen={false} onClose={mockOnClose} projectId="p1" />),
    ).not.toThrow();
  });

  it('does not show panel title when closed', () => {
    render(<CollaborationPanel isOpen={false} onClose={mockOnClose} projectId="p1" />);
    expect(screen.queryByText('collab.title')).toBeNull();
  });

  it('shows panel content when open', () => {
    render(<CollaborationPanel isOpen={true} onClose={mockOnClose} projectId="p1" />);
    expect(screen.getByText('collab.title')).toBeTruthy();
    expect(screen.getByText(/collab\.p2pTitle/)).toBeTruthy();
  });

  it('shows room ID label when open', () => {
    render(<CollaborationPanel isOpen={true} onClose={mockOnClose} projectId="p1" />);
    expect(screen.getByText('collab.roomId')).toBeTruthy();
  });

  it('shows identity section when open', () => {
    render(<CollaborationPanel isOpen={true} onClose={mockOnClose} projectId="p1" />);
    expect(screen.getByText('collab.identity')).toBeTruthy();
  });
});
