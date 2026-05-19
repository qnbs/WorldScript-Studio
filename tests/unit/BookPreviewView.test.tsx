import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: vi.fn((selector: (s: any) => unknown) => selector(mockAppState as any)),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelectorShallow: vi.fn((selector: (s: any) => unknown) => selector(mockAppState as any)),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../components/ui/SectionIcon', () => ({
  SectionIcon: () => null,
}));

// biome-ignore lint/complexity/noUselessConstructor: required to satisfy IntersectionObserver constructor contract
class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

describe('BookPreviewView', () => {
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

  it('changes font family via select', () => {
    render(<BookPreviewView />);
    const select = screen.getByRole('combobox', { name: 'preview.controls.fontFamily' });
    fireEvent.change(select, { target: { value: 'serif' } });
    expect((select as HTMLSelectElement).value).toBe('serif');
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

  it('shows no-scenes message when manuscript is empty', async () => {
    const { useAppSelector } = await import('../../app/hooks');
    const emptyState = { ...mockAppState, project: { present: { data: { manuscript: [] } } } };
    vi.mocked(useAppSelector).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (selector: (s: any) => unknown) => selector(emptyState as any),
    );
    render(<BookPreviewView />);
    expect(screen.getByText('preview.noScenes')).toBeDefined();
    // Reset
    vi.mocked(useAppSelector).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (selector: (s: any) => unknown) => selector(mockAppState as any),
    );
  });
});
