import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootState } from '../../app/store';
import { BookPreviewView } from '../../components/BookPreviewView';

const mockSections = [
  {
    id: 's1',
    title: 'Chapter One',
    content: 'The story begins here with many words.',
    type: 'chapter',
  },
  {
    id: 's2',
    title: 'Chapter Two',
    content: 'The plot thickens considerably now.',
    type: 'chapter',
  },
  { id: 's3', title: '', content: '', type: 'scene' },
];

const mockAppState = {
  project: { present: { data: { manuscript: mockSections } } },
  settings: { language: 'en', theme: 'dark' },
};

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: RootState) => unknown) =>
    selector(mockAppState as unknown as RootState),
  ),
  useAppSelectorShallow: vi.fn((selector: (s: RootState) => unknown) =>
    selector(mockAppState as unknown as RootState),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../components/ui/SectionIcon', () => ({
  SectionIcon: () => null,
}));

// QNBS-v3: jsdom has 0-height containers so useVirtualizer renders no items — mock it to render all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 600,
        size: 600,
        key: i,
        lane: 0,
      })),
    getTotalSize: () => count * 600,
    measureElement: vi.fn((_el: unknown) => {}),
    scrollToIndex: vi.fn(),
  }),
}));

class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

describe('BookPreviewView', () => {
  // QNBS-v3: reading prefs persist to localStorage now — clear so font-size/toggle tests stay isolated.
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders section titles in h2 elements', () => {
    render(<BookPreviewView />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    const titles = headings.map((h) => h.textContent);
    expect(titles).toContain('Chapter One');
    expect(titles).toContain('Chapter Two');
  });

  it('renders section content', () => {
    render(<BookPreviewView />);
    expect(screen.getByText('The story begins here with many words.')).toBeDefined();
  });

  it('renders fallback text for untitled sections', () => {
    render(<BookPreviewView />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.some((h) => h.textContent === 'preview.untitledScene')).toBe(true);
  });

  it('toggles fullscreen mode on button click', () => {
    render(<BookPreviewView />);
    const fsBtn = screen.getByLabelText('preview.controls.fullscreen');
    fireEvent.click(fsBtn);
    expect(screen.getByLabelText('preview.controls.exitFullscreen')).toBeDefined();
  });

  it('exits fullscreen when exit button clicked again', () => {
    render(<BookPreviewView />);
    fireEvent.click(screen.getByLabelText('preview.controls.fullscreen'));
    fireEvent.click(screen.getByLabelText('preview.controls.exitFullscreen'));
    expect(screen.getByLabelText('preview.controls.fullscreen')).toBeDefined();
  });

  it('opens TOC when toggle button clicked', () => {
    render(<BookPreviewView />);
    fireEvent.click(screen.getByLabelText('preview.toc.toggle'));
    expect(screen.getByRole('navigation', { name: 'preview.toc.ariaLabel' })).toBeDefined();
  });

  it('closes TOC when close button inside TOC clicked', () => {
    render(<BookPreviewView />);
    fireEvent.click(screen.getByLabelText('preview.toc.toggle'));
    fireEvent.click(screen.getByLabelText('preview.toc.close'));
    expect(screen.queryByRole('navigation', { name: 'preview.toc.ariaLabel' })).toBeNull();
  });

  it('enables word count display after toggle', () => {
    render(<BookPreviewView />);
    const wcBtn = screen.getByLabelText('preview.controls.wordCount');
    expect(wcBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(wcBtn);
    expect(wcBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('increases font size via A+ button', () => {
    render(<BookPreviewView />);
    expect(screen.getByText('16')).toBeDefined();
    fireEvent.click(screen.getByLabelText('preview.controls.increaseFontSize'));
    expect(screen.getByText('17')).toBeDefined();
  });

  it('decreases font size via A- button', () => {
    render(<BookPreviewView />);
    fireEvent.click(screen.getByLabelText('preview.controls.decreaseFontSize'));
    expect(screen.getByText('15')).toBeDefined();
  });

  it('changes font family via select', async () => {
    const user = userEvent.setup();
    render(<BookPreviewView />);
    const button = screen.getByLabelText('preview.controls.fontFamily');
    await user.click(button);
    // The Select component is a custom dropdown, not a native select
    // Mock returns the key, not the translated value
    const serifOption = screen.getByRole('option', { name: 'preview.controls.fontSerif' });
    await user.click(serifOption);
    // Verify the selection changed by checking the button text
    expect(button.textContent).toContain('preview.controls.fontSerif');
  });

  it('exits fullscreen on Escape key', () => {
    render(<BookPreviewView />);
    fireEvent.click(screen.getByLabelText('preview.controls.fullscreen'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByLabelText('preview.controls.fullscreen')).toBeDefined();
  });

  it('renders toolbar with correct role', () => {
    render(<BookPreviewView />);
    expect(screen.getByRole('toolbar', { name: 'preview.controls.ariaLabel' })).toBeDefined();
  });

  it('renders a reading-progress bar', () => {
    render(<BookPreviewView />);
    const bar = screen.getByRole('progressbar', { name: 'preview.progress.ariaLabel' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('toggles paged reading mode', () => {
    render(<BookPreviewView />);
    const pagedBtn = screen.getByLabelText('preview.controls.pagedMode');
    expect(pagedBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pagedBtn);
    expect(pagedBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('hands off to the export view when Export is clicked', () => {
    const onNavigate = vi.fn();
    render(<BookPreviewView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByLabelText('preview.controls.export'));
    expect(onNavigate).toHaveBeenCalledWith('export');
  });

  it('shows no-scenes message when manuscript is empty', async () => {
    const { useAppSelector } = await import('../../app/hooks');
    const emptyState = { ...mockAppState, project: { present: { data: { manuscript: [] } } } };
    vi.mocked(useAppSelector).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(emptyState as unknown as RootState),
    );
    render(<BookPreviewView />);
    expect(screen.getByText('preview.noScenes')).toBeDefined();
    // Reset
    vi.mocked(useAppSelector).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(mockAppState as unknown as RootState),
    );
  });
});
