import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterGraphView } from '../../components/CharacterGraphView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// ForceGraph2D uses Canvas/WebGL which jsdom doesn't support
vi.mock('react-force-graph-2d', () => ({
  default: () => <div data-testid="force-graph-mock" />,
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: { theme: 'dark', appearancePreset: 'default' },
      project: {
        present: {
          data: {
            title: 'Test Story',
            manuscript: [],
            outline: [],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            relationships: [],
          },
        },
      },
    }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CharacterGraphView', () => {
  it('renders without throwing', () => {
    expect(() => render(<CharacterGraphView />)).not.toThrow();
  });

  it('shows graph title', () => {
    render(<CharacterGraphView />);
    expect(screen.getByText('characterGraph.title')).toBeTruthy();
  });

  it('shows graph and table view toggle buttons', () => {
    render(<CharacterGraphView />);
    expect(screen.getByText('characterGraph.view.graph')).toBeTruthy();
    expect(screen.getByText('characterGraph.view.table')).toBeTruthy();
  });

  it('shows legend section', () => {
    render(<CharacterGraphView />);
    expect(screen.getByText('characterGraph.legend')).toBeTruthy();
  });

  it('shows empty-characters fallback inside graph area', () => {
    render(<CharacterGraphView />);
    // With no characters the ForceGraph sub-component shows the noCharacters message
    expect(screen.getByText('charGraph.noCharacters')).toBeTruthy();
  });
});
