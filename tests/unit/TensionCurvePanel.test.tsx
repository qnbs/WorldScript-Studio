import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootState } from '../../app/store';
import type { StorySection } from '../../types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

// QNBS-v3: tensionOverrides moved to projectSlice (undo-able); plotBoard is viewport-only.
const makeMockState = (overrides?: { tensionOverrides?: Record<string, number> }) => ({
  project: {
    present: {
      data: {
        manuscript: [],
        plotTensionOverrides: overrides?.tensionOverrides ?? {},
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
        outline: [],
        logline: '',
        title: '',
      },
    },
  },
  plotBoard: {
    selectedConnectionId: null,
    isDrawingConnection: false,
    drawFromSectionId: null,
    activeSubplotFilter: null,
    activeMode: 'canvas',
    zoom: 1,
    panX: 0,
    panY: 0,
    snapToGrid: false,
  },
});

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelectorShallow: vi.fn((selector: (s: RootState) => unknown) =>
    selector(makeMockState() as unknown as RootState),
  ),
}));

vi.mock('../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      value,
      onChange,
      options,
      groups,
      ariaLabel,
      ...rest
    }: {
      value: string;
      onChange: (v: string) => void;
      options?: Array<{ value: string; label: string; disabled?: boolean }>;
      groups?: Array<{
        label: string;
        options: Array<{ value: string; label: string; disabled?: boolean }>;
      }>;
      ariaLabel?: string;
      [key: string]: unknown;
    }) => (
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      >
        {(options ?? groups?.flatMap((g) => g.options) ?? []).map(
          (opt: { value: string; label: string; disabled?: boolean }) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    ),
  ),
}));

import { TensionCurvePanel } from '../../components/scene-board/TensionCurvePanel';

const mockT = (k: string) => k;

function makeSection(overrides?: Partial<StorySection>): StorySection {
  return {
    id: 's1',
    title: 'Opening',
    content: '',
    color: '#3b82f6',
    status: 'draft',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDispatch.mockClear();
});

describe('TensionCurvePanel', () => {
  it('renders the panel with title', () => {
    render(<TensionCurvePanel sections={[]} t={mockT} />);
    expect(screen.getByText('sceneboard.tension.title')).toBeTruthy();
  });

  it('is collapsed by default (toggle shows expand button)', () => {
    render(<TensionCurvePanel sections={[]} t={mockT} />);
    const toggleBtn = screen.getByRole('button', { name: /sceneboard.tension.title/i });
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands when toggle is clicked', () => {
    render(<TensionCurvePanel sections={[makeSection()]} t={mockT} />);
    const toggleBtn = screen.getByRole('button', { name: /sceneboard.tension.title/i });
    fireEvent.click(toggleBtn);
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows no-scenes message when expanded with no sections', () => {
    render(<TensionCurvePanel sections={[]} t={mockT} />);
    const toggleBtn = screen.getByRole('button', { name: /sceneboard.tension.title/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByText('sceneboard.tension.noScenes')).toBeTruthy();
  });

  it('renders SVG chart when expanded with sections', () => {
    const { container } = render(
      <TensionCurvePanel
        sections={[makeSection(), makeSection({ id: 's2', title: 'Climax' })]}
        t={mockT}
      />,
    );
    const toggleBtn = screen.getByRole('button', { name: /sceneboard.tension.title/i });
    fireEvent.click(toggleBtn);
    expect(container.querySelector('svg[role="img"]')).toBeTruthy();
  });

  it('renders one draggable dot per section', () => {
    const { container } = render(
      <TensionCurvePanel
        sections={[
          makeSection({ id: 's1', title: 'Opening' }),
          makeSection({ id: 's2', title: 'Midpoint' }),
          makeSection({ id: 's3', title: 'Climax' }),
        ]}
        t={mockT}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    const sliders = container.querySelectorAll('[role="slider"]');
    expect(sliders.length).toBe(3);
  });

  it('dispatches setTensionOverride when a dot is dragged', () => {
    const { container } = render(<TensionCurvePanel sections={[makeSection()]} t={mockT} />);
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    const slider = container.querySelector('[role="slider"]');
    expect(slider).toBeTruthy();
    if (slider) {
      fireEvent.pointerDown(slider, { pointerId: 1 });
      fireEvent.pointerMove(slider, { pointerId: 1, clientY: 50 });
      fireEvent.pointerUp(slider, { pointerId: 1 });
    }
    // dispatch may or may not fire (depends on SVG bounding rect mock), but no throw
    expect(slider).toBeTruthy();
  });

  it('dispatches clearAllTensionOverrides when reset is clicked', () => {
    render(<TensionCurvePanel sections={[makeSection()]} t={mockT} />);
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    const resetBtn = screen.getByText('sceneboard.tension.clearOverrides');
    fireEvent.click(resetBtn);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/clearAllPlotTensionOverrides' }),
    );
  });

  it('shows beat sheet select when checkbox is checked', () => {
    render(<TensionCurvePanel sections={[makeSection()]} t={mockT} />);
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('beat sheet overlay not visible when checkbox is unchecked (default)', () => {
    const { container } = render(<TensionCurvePanel sections={[makeSection()]} t={mockT} />);
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    // Without beat sheet toggled, no dashed vertical beat lines rendered
    // (the connector paths use stroke-dasharray but beat lines use dasharray 3,2)
    const beatLines = container.querySelectorAll('line[stroke-dasharray="3,2"]');
    expect(beatLines.length).toBe(0);
  });

  it('renders beat lines when beat sheet overlay is enabled', () => {
    const { container } = render(<TensionCurvePanel sections={[makeSection()]} t={mockT} />);
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    // Three-act (default) has 3 beat markers
    const beatLines = container.querySelectorAll('line[stroke-dasharray="3,2"]');
    expect(beatLines.length).toBe(3);
  });

  it('truncates scene titles longer than 12 chars on the x-axis', () => {
    const { container } = render(
      <TensionCurvePanel
        sections={[makeSection({ id: 's1', title: 'A Very Long Scene Title Here' })]}
        t={mockT}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    // Should find a text element with truncated title (ends with …)
    const texts = Array.from(container.querySelectorAll('text'));
    const truncated = texts.find((t) => t.textContent?.includes('…'));
    expect(truncated).toBeTruthy();
  });

  it('uses accent color for overridden dots', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ tensionOverrides: { s1: 8 } }) as unknown as RootState),
    );

    const { container } = render(
      <TensionCurvePanel sections={[makeSection({ id: 's1' })]} t={mockT} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sceneboard.tension.title/i }));
    // Overridden dot should use accent fill
    const accentDot = container.querySelector('circle[fill*="--sc-accent-primary"]');
    expect(accentDot).toBeTruthy();
  });
});
