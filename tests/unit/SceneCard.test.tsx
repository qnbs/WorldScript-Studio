/**
 * Tests for components/scene-board/SceneCard.tsx
 * QNBS-v3: Mocks @dnd-kit/sortable + UI atoms; tests render, edit mode, delete, reorder.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

// Textarea and Input use useAppSelector — mock them to avoid Redux store dep
vi.mock('../../components/ui/Textarea', () => ({
  Textarea: vi.fn(
    ({
      value,
      onChange,
      placeholder,
      ...rest
    }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea value={value} onChange={onChange} placeholder={placeholder} {...rest} />
    ),
  ),
}));

vi.mock('../../components/ui/Input', () => ({
  Input: vi.fn(
    ({ value, onChange, placeholder, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { SceneCard } from '../../components/scene-board/SceneCard';
import type { StorySection } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// t returns key with replacements serialized (like '{title}' replaced)
const t = (k: string, opts?: Record<string, string>) => (opts ? `${k}:${JSON.stringify(opts)}` : k);

const SECTION: StorySection = {
  id: 'sec-1',
  title: 'The Arrival',
  content: '',
  act: 1,
  wordCount: 150,
  color: '#3b82f6',
  status: 'draft',
  summary: 'Character arrives in town',
};

const BASE_PROPS = {
  section: SECTION,
  characters: [],
  locationOptions: [],
  t,
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  sceneIndexInAct: 1,
  actLaneLength: 3,
  onReorderInAct: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section title', () => {
    render(<SceneCard {...BASE_PROPS} />);
    expect(screen.getByText('The Arrival')).toBeInTheDocument();
  });

  it('renders the section summary', () => {
    render(<SceneCard {...BASE_PROPS} />);
    expect(screen.getByText('Character arrives in town')).toBeInTheDocument();
  });

  it('renders the word count', () => {
    render(<SceneCard {...BASE_PROPS} />);
    expect(screen.getByText(/150/)).toBeInTheDocument();
  });

  it('renders edit button with aria-label', () => {
    render(<SceneCard {...BASE_PROPS} />);
    const editBtn = screen.getByRole('button', {
      name: t('sceneboard.editScene', { title: 'The Arrival' }),
    });
    expect(editBtn).toBeInTheDocument();
  });

  it('enters edit mode when edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<SceneCard {...BASE_PROPS} />);
    await user.click(
      screen.getByRole('button', { name: t('sceneboard.editScene', { title: 'The Arrival' }) }),
    );
    // In edit mode, save and cancel buttons appear
    expect(screen.getByText('common.save')).toBeInTheDocument();
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
  });

  it('calls onUpdate when save is clicked in edit mode', async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<SceneCard {...BASE_PROPS} onUpdate={onUpdate} />);
    await user.click(
      screen.getByRole('button', { name: t('sceneboard.editScene', { title: 'The Arrival' }) }),
    );
    await user.click(screen.getByText('common.save'));
    expect(onUpdate).toHaveBeenCalledWith('sec-1', expect.any(Object));
  });

  it('calls onDelete when delete button clicked in edit mode', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<SceneCard {...BASE_PROPS} onDelete={onDelete} />);
    await user.click(
      screen.getByRole('button', { name: t('sceneboard.editScene', { title: 'The Arrival' }) }),
    );
    await user.click(screen.getByText('common.delete'));
    expect(onDelete).toHaveBeenCalledWith('sec-1');
  });

  it('exits edit mode when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<SceneCard {...BASE_PROPS} />);
    await user.click(
      screen.getByRole('button', { name: t('sceneboard.editScene', { title: 'The Arrival' }) }),
    );
    await user.click(screen.getByText('common.cancel'));
    expect(screen.queryByText('common.save')).not.toBeInTheDocument();
  });

  it('disables move-up button when at first position', () => {
    render(<SceneCard {...BASE_PROPS} sceneIndexInAct={0} />);
    expect(screen.getByRole('button', { name: 'common.moveUp' })).toBeDisabled();
  });

  it('disables move-down button when at last position', () => {
    render(<SceneCard {...BASE_PROPS} sceneIndexInAct={2} actLaneLength={3} />);
    expect(screen.getByRole('button', { name: 'common.moveDown' })).toBeDisabled();
  });

  it('calls onReorderInAct with down when move-down is clicked', async () => {
    const onReorderInAct = vi.fn();
    const user = userEvent.setup();
    render(
      <SceneCard
        {...BASE_PROPS}
        onReorderInAct={onReorderInAct}
        sceneIndexInAct={0}
        actLaneLength={3}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'common.moveDown' }));
    expect(onReorderInAct).toHaveBeenCalledWith('sec-1', 'down');
  });

  it('calls onReorderInAct with up when move-up is clicked', async () => {
    const onReorderInAct = vi.fn();
    const user = userEvent.setup();
    render(
      <SceneCard
        {...BASE_PROPS}
        onReorderInAct={onReorderInAct}
        sceneIndexInAct={2}
        actLaneLength={3}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'common.moveUp' }));
    expect(onReorderInAct).toHaveBeenCalledWith('sec-1', 'up');
  });
});
