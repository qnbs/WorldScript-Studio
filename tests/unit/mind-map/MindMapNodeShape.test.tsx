/**
 * Tests for components/mind-map/MindMapNodeShape.tsx
 * QNBS-v3: Pure SVG component; tests all shapes, selection state, label truncation, keyboard interaction.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MindMapNodeShape } from '../../../components/mind-map/MindMapNodeShape';
import type { MindMapNode } from '../../../types';

function makeNode(overrides: Partial<MindMapNode> = {}): MindMapNode {
  return {
    id: 'n1',
    label: 'My Node',
    type: 'free',
    shape: 'rectangle',
    color: '#6366f1',
    position: { x: 100, y: 100 },
    textNotes: '',
    ...overrides,
  } as MindMapNode;
}

describe('MindMapNodeShape', () => {
  it('renders a group with role="button"', () => {
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode()}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByRole('button', { name: 'My Node' })).toBeInTheDocument();
  });

  it('sets aria-pressed false when not selected', () => {
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode()}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets aria-pressed true when selected', () => {
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode()}
          isSelected={true}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode()}
          isSelected={false}
          onClick={onClick}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('calls onClick on Enter key press', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode()}
          isSelected={false}
          onClick={onClick}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalled();
  });

  it('calls onDoubleClick on F2 key press', async () => {
    const onDoubleClick = vi.fn();
    const user = userEvent.setup();
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode()}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={onDoubleClick}
        />
      </svg>,
    );
    screen.getByRole('button').focus();
    await user.keyboard('{F2}');
    expect(onDoubleClick).toHaveBeenCalled();
  });

  it('renders full label when ≤14 chars', () => {
    render(
      <svg>
        <MindMapNodeShape
          node={makeNode({ label: 'Short' })}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByText('Short')).toBeInTheDocument();
  });

  it('truncates label when >14 chars', () => {
    const { container } = render(
      <svg>
        <MindMapNodeShape
          node={makeNode({ label: 'This Is A Very Long Label' })}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    // Find the SVG <text> element's content — jsdom renders it as textContent
    const textEl = container.querySelector('text');
    expect(textEl?.textContent).toMatch(/^This Is A Ver/);
  });

  it('renders circle shape as ellipse SVG element', () => {
    const { container } = render(
      <svg>
        <MindMapNodeShape
          node={makeNode({ shape: 'circle' })}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    expect(container.querySelector('ellipse')).toBeInTheDocument();
  });

  it('renders diamond shape as polygon SVG element', () => {
    const { container } = render(
      <svg>
        <MindMapNodeShape
          node={makeNode({ shape: 'diamond' })}
          isSelected={false}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
        />
      </svg>,
    );
    expect(container.querySelector('polygon')).toBeInTheDocument();
  });
});
