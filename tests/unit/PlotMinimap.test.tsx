/**
 * Tests for components/scene-board/PlotMinimap.tsx
 * QNBS-v3: Pure SVG rendering — no external deps.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MINIMAP_H, MINIMAP_W, PlotMinimap } from '../../components/scene-board/PlotMinimap';
import type { StorySection } from '../../types';

const SECTION: StorySection = {
  id: 'sec-1',
  title: 'Scene 1',
  content: '',
  act: 1,
  wordCount: 0,
  type: 'scene',
  order: 0,
  color: '#ff0000',
};

const BASE_PROPS = {
  sections: [],
  layout: {},
  canvasW: 2000,
  canvasH: 1500,
  panX: 0,
  panY: 0,
  zoom: 1,
};

describe('PlotMinimap', () => {
  it('renders an SVG element', () => {
    render(<PlotMinimap {...BASE_PROPS} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('uses default aria-label', () => {
    render(<PlotMinimap {...BASE_PROPS} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Canvas mini-map');
  });

  it('uses custom aria-label when provided', () => {
    render(<PlotMinimap {...BASE_PROPS} ariaLabel="Overview map" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Overview map');
  });

  it('uses default MINIMAP_W and MINIMAP_H dimensions', () => {
    const { container } = render(<PlotMinimap {...BASE_PROPS} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe(String(MINIMAP_W));
    expect(svg?.getAttribute('height')).toBe(String(MINIMAP_H));
  });

  it('uses custom width/height when provided', () => {
    const { container } = render(<PlotMinimap {...BASE_PROPS} width={200} height={100} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('100');
  });

  it('renders no section rects when layout is empty', () => {
    const { container } = render(<PlotMinimap {...BASE_PROPS} sections={[SECTION]} />);
    // Only the viewport rect should be present (section has no layout entry)
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(1); // only viewport rect
  });

  it('renders a rect for each section with layout position', () => {
    const { container } = render(
      <PlotMinimap {...BASE_PROPS} sections={[SECTION]} layout={{ 'sec-1': { x: 100, y: 200 } }} />,
    );
    // section rect + viewport rect
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
  });

  it('section rect uses section color as fill', () => {
    const { container } = render(
      <PlotMinimap {...BASE_PROPS} sections={[SECTION]} layout={{ 'sec-1': { x: 0, y: 0 } }} />,
    );
    const sectionRect = container.querySelector('rect[fill="#ff0000"]');
    expect(sectionRect).toBeInTheDocument();
  });

  it('exports MINIMAP_W and MINIMAP_H constants', () => {
    expect(typeof MINIMAP_W).toBe('number');
    expect(typeof MINIMAP_H).toBe('number');
    expect(MINIMAP_W).toBeGreaterThan(0);
    expect(MINIMAP_H).toBeGreaterThan(0);
  });
});
