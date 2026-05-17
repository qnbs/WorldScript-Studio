import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SceneTimelinePanel } from '../../components/SceneTimelinePanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/sceneTimelineRules', () => ({
  evaluateSceneTimeline: vi.fn(() => []),
  parseSceneDurationMs: vi.fn(() => null),
  parseSceneStartMs: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const t = (k: string) => k;

type Section = Parameters<typeof SceneTimelinePanel>[0]['sections'][number];

function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    id: `sec-${Math.random()}`,
    title: 'Chapter One',
    content: 'Hello world from a test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneTimelinePanel', () => {
  it('renders without throwing with empty sections', () => {
    expect(() => render(<SceneTimelinePanel sections={[]} t={t} />)).not.toThrow();
  });

  it('renders section titles in the word-share chart', () => {
    const sections = [makeSection({ title: 'Intro' }), makeSection({ title: 'Rising Action' })];
    render(<SceneTimelinePanel sections={sections} t={t} />);
    expect(screen.getAllByText('Intro').length).toBeGreaterThan(0);
  });

  it('renders without throwing with section having wordCount', () => {
    const sections = [makeSection({ content: 'one two three', wordCount: 3 })];
    expect(() => render(<SceneTimelinePanel sections={sections} t={t} />)).not.toThrow();
  });

  it('renders hint row when evaluateSceneTimeline returns hints', async () => {
    const { evaluateSceneTimeline } = await import('../../services/sceneTimelineRules');
    vi.mocked(evaluateSceneTimeline).mockReturnValueOnce([
      { id: 'h1', severity: 'warn', messageKey: 'scene.hint.long' },
    ]);
    const sections = [makeSection()];
    render(<SceneTimelinePanel sections={sections} t={t} />);
    // hint message key is passed through t() — check it appears
    expect(screen.getByText('scene.hint.long')).toBeTruthy();
  });

  it('does not render timed lanes when no sections have sceneStart', () => {
    const sections = [makeSection()];
    const { container } = render(<SceneTimelinePanel sections={sections} t={t} />);
    // No timeline track items should be rendered without sceneStart
    expect(container.querySelector('[class*="timeline-track"]')).toBeNull();
  });
});
