import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ManuscriptResearchSplit } from '../../components/ManuscriptResearchSplit';
import type { BinderNode } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    getBinderAsset: vi.fn().mockResolvedValue(null),
  },
}));

const mockOnClose = vi.fn();
const mockProjectId = 'proj-1';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManuscriptResearchSplit', () => {
  it('renders without throwing when node is undefined', () => {
    expect(() =>
      render(
        <ManuscriptResearchSplit
          projectId={mockProjectId}
          node={undefined}
          onClose={mockOnClose}
        />,
      ),
    ).not.toThrow();
  });

  it('shows empty state message when no node', () => {
    render(
      <ManuscriptResearchSplit projectId={mockProjectId} node={undefined} onClose={mockOnClose} />,
    );
    // Both the h3 title and the <p> body may show the empty key
    const matches = screen.getAllByText('manuscript.researchSplit.empty');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows node title when node with title is provided', () => {
    const node: BinderNode = {
      id: 'n1',
      title: 'Chapter One',
      type: 'text',
      parentId: null,
      sortIndex: 0,
      content: 'Some content',
    };
    render(<ManuscriptResearchSplit projectId={mockProjectId} node={node} onClose={mockOnClose} />);
    expect(screen.getByText('Chapter One')).toBeTruthy();
  });

  it('shows note content for text/note nodes', () => {
    const node: BinderNode = {
      id: 'n2',
      title: 'Notes',
      type: 'note',
      parentId: null,
      sortIndex: 0,
      content: 'Research notes here',
    };
    render(<ManuscriptResearchSplit projectId={mockProjectId} node={node} onClose={mockOnClose} />);
    expect(screen.getByText('Research notes here')).toBeTruthy();
  });

  it('shows link URL for link nodes', () => {
    const node: BinderNode = {
      id: 'n3',
      title: 'External Link',
      type: 'link',
      parentId: null,
      sortIndex: 0,
      linkUrl: 'https://example.com',
    };
    render(<ManuscriptResearchSplit projectId={mockProjectId} node={node} onClose={mockOnClose} />);
    expect(screen.getByText('https://example.com')).toBeTruthy();
  });

  it('shows close button', () => {
    render(
      <ManuscriptResearchSplit projectId={mockProjectId} node={undefined} onClose={mockOnClose} />,
    );
    expect(screen.getByText('manuscript.researchSplit.close')).toBeTruthy();
  });
});
