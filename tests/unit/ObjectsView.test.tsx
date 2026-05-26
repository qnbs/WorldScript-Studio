import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectsView } from '../../components/ObjectsView';
import type { ObjectGroup, StoryObject } from '../../types';

const mockDispatch = vi.fn();

const makeObj = (overrides?: Partial<StoryObject>): StoryObject => ({
  id: 'obj-1',
  name: 'Excalibur',
  description: 'A legendary sword',
  type: 'weapon',
  groupIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeGroup = (overrides?: Partial<ObjectGroup>): ObjectGroup => ({
  id: 'grp-1',
  name: 'Weapons',
  color: '#ef4444',
  objectIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeMockState = (storyObjects: StoryObject[] = [], objectGroups: ObjectGroup[] = []) => ({
  project: {
    present: {
      data: {
        title: '',
        logline: '',
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        characters: { ids: [], entities: {} } as any,
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        worlds: { ids: [], entities: {} } as any,
        outline: [],
        manuscript: [],
        storyObjects,
        objectGroups,
      },
    },
  },
  settings: { language: 'en', theme: 'dark' },
});

let mockState = makeMockState();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: vi.fn((selector: (s: any) => unknown) => selector(mockState as any)),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelectorShallow: vi.fn((selector: (s: any) => unknown) => selector(mockState as any)),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

beforeEach(() => {
  mockState = makeMockState();
  mockDispatch.mockClear();
});

describe('ObjectsView', () => {
  it('renders the view title and subtitle', () => {
    render(<ObjectsView />);
    expect(screen.getByText('objects.title')).toBeInTheDocument();
  });

  it('renders tabs for Objects and Groups', () => {
    render(<ObjectsView />);
    expect(screen.getByText('objects.tabObjects')).toBeInTheDocument();
    expect(screen.getByText('objects.tabGroups')).toBeInTheDocument();
  });

  it('shows empty state when no objects exist', () => {
    render(<ObjectsView />);
    expect(screen.getByText('objects.emptyState')).toBeInTheDocument();
  });

  it('renders an object card when objects exist', () => {
    mockState = makeMockState([makeObj()]);
    render(<ObjectsView />);
    expect(screen.getByText('Excalibur')).toBeInTheDocument();
    expect(screen.getByText('A legendary sword')).toBeInTheDocument();
  });

  it('shows the object form when Add Object is clicked', () => {
    render(<ObjectsView />);
    // getAllByText because multiple "Add Object" buttons may exist (header + empty state)
    fireEvent.click(screen.getAllByText('objects.addObject')[0] as HTMLElement);
    expect(screen.getByPlaceholderText('objects.namePlaceholder')).toBeInTheDocument();
  });

  it('dispatches addStoryObject when form is submitted', () => {
    render(<ObjectsView />);
    fireEvent.click(screen.getAllByText('objects.addObject')[0] as HTMLElement);
    const input = screen.getByPlaceholderText('objects.namePlaceholder');
    fireEvent.change(input, { target: { value: 'Ring of Power' } });
    fireEvent.click(screen.getByText('objects.save'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addStoryObject' }),
    );
  });

  it('switches to Groups tab and shows empty state', () => {
    render(<ObjectsView />);
    fireEvent.click(screen.getByText('objects.tabGroups'));
    expect(screen.getByText('objects.emptyGroupsState')).toBeInTheDocument();
  });

  it('renders a group card when groups exist', () => {
    mockState = makeMockState([], [makeGroup()]);
    render(<ObjectsView />);
    fireEvent.click(screen.getByText('objects.tabGroups'));
    expect(screen.getByText('Weapons')).toBeInTheDocument();
  });

  it('dispatches addObjectGroup when group form is submitted', () => {
    render(<ObjectsView />);
    fireEvent.click(screen.getByText('objects.tabGroups'));
    fireEvent.click(screen.getByText('objects.addGroup'));
    const input = screen.getByPlaceholderText('objects.groupNamePlaceholder');
    fireEvent.change(input, { target: { value: 'Magic Items' } });
    fireEvent.click(screen.getByText('objects.save'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addObjectGroup' }),
    );
  });

  it('filters objects by search query', () => {
    mockState = makeMockState([
      makeObj({ id: 'obj-1', name: 'Excalibur' }),
      makeObj({ id: 'obj-2', name: 'Shield of Light' }),
    ]);
    render(<ObjectsView />);
    const searchInput = screen.getByPlaceholderText('objects.search');
    fireEvent.change(searchInput, { target: { value: 'shield' } });
    expect(screen.queryByText('Excalibur')).not.toBeInTheDocument();
    expect(screen.getByText('Shield of Light')).toBeInTheDocument();
  });

  it('cancel button hides the form', () => {
    render(<ObjectsView />);
    fireEvent.click(screen.getAllByText('objects.addObject')[0] as HTMLElement);
    expect(screen.getByPlaceholderText('objects.namePlaceholder')).toBeInTheDocument();
    fireEvent.click(screen.getByText('objects.cancel'));
    expect(screen.queryByPlaceholderText('objects.namePlaceholder')).not.toBeInTheDocument();
  });
});
