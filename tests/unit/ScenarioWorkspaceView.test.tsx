import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppSelector } from '../../app/hooks';
import { ScenarioWorkspaceView } from '../../components/ScenarioWorkspaceView';
import type { StoryProject } from '../../types';

const project: StoryProject = {
  title: 'Pilot',
  logline: '',
  characters: [{ id: 'c1', name: 'A' }] as unknown as StoryProject['characters'],
  worlds: [{ id: 'w1', name: 'World' }] as unknown as StoryProject['worlds'],
  outline: [{ id: 'o1', title: 'Act I', description: '', isTwist: false }],
  manuscript: [{ id: 's1', title: 'Opening', content: 'one two', summary: '' }],
};

vi.mock('../../app/hooks', () => ({
  useAppSelector: vi.fn(),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('../../components/ui/Card', () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock('../../components/ui/PageContainer', () => ({
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('../../components/ui/SectionIcon', () => ({
  SectionIcon: ({ section }: { section: string }) => <span data-testid={`icon-${section}`} />,
}));

// QNBS-v3: Protect canonical Scenario rendering and card navigation from regressions.
describe('ScenarioWorkspaceView', () => {
  beforeEach(() => {
    vi.mocked(useAppSelector).mockImplementation(() => project);
  });

  it('renders canonical project metrics and navigates from projection cards', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(<ScenarioWorkspaceView onNavigate={onNavigate} />);

    expect(screen.getByRole('heading', { name: 'sidebar.scenario' })).toBeInTheDocument();
    expect(screen.getByText('Pilot')).toBeInTheDocument();
    expect(screen.getByText('dashboard.noLogline')).toBeInTheDocument();
    expect(screen.queryByText('empty.manuscript.description')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'sidebar.characters' }));
    await user.click(screen.getByRole('button', { name: 'sidebar.world' }));
    await user.click(screen.getByRole('button', { name: 'sidebar.outline' }));
    await user.click(screen.getByRole('button', { name: 'sidebar.sceneboard' }));
    await user.click(screen.getByRole('button', { name: 'sidebar.manuscript' }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'characters');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'world');
    expect(onNavigate).toHaveBeenNthCalledWith(3, 'outline');
    expect(onNavigate).toHaveBeenNthCalledWith(4, 'sceneboard');
    expect(onNavigate).toHaveBeenNthCalledWith(5, 'manuscript');
  });

  it('renders populated logline and section summary content', () => {
    vi.mocked(useAppSelector).mockImplementationOnce(() => ({
      ...project,
      logline: 'A populated logline',
      manuscript: [{ ...project.manuscript[0], summary: 'A populated summary' }],
    }));

    render(<ScenarioWorkspaceView onNavigate={vi.fn()} />);

    expect(screen.getByText('A populated logline')).toBeInTheDocument();
    expect(screen.getByText('A populated summary')).toBeInTheDocument();
  });

  it('renders the empty manuscript state and returns null without a project', () => {
    vi.mocked(useAppSelector).mockImplementationOnce(() => ({ ...project, manuscript: [] }));
    const { rerender } = render(<ScenarioWorkspaceView onNavigate={vi.fn()} />);

    expect(screen.getByText('empty.manuscript.description')).toBeInTheDocument();

    vi.mocked(useAppSelector).mockImplementation(() => null);
    rerender(<ScenarioWorkspaceView onNavigate={vi.fn()} />);

    expect(screen.queryByRole('main')).toBeNull();
  });
});
