import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStatsBadge } from '../../../components/manuscript/EditorStatsBadge';
import type { AdvancedEditorSettings } from '../../../types';

let advancedEditor: Partial<AdvancedEditorSettings> | undefined;

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ settings: { advancedEditor } }),
  ),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.['time'] ? `${key}:${params['time']}` : key,
  }),
}));

describe('EditorStatsBadge (#818)', () => {
  beforeEach(() => {
    advancedEditor = { wordCount: true, readingTime: true };
  });

  it('shows the word count and the reading time', () => {
    render(<EditorStatsBadge wordCount={450} readTime={2} />);
    expect(
      screen.getByText('450 common.words · manuscript.inspector.readTimeValue:2'),
    ).toBeInTheDocument();
  });

  it('follows each Settings → Advanced Editor toggle', () => {
    advancedEditor = { wordCount: false, readingTime: true };
    const { rerender } = render(<EditorStatsBadge wordCount={450} readTime={2} />);
    expect(screen.getByText('manuscript.inspector.readTimeValue:2')).toBeInTheDocument();
    advancedEditor = { wordCount: true, readingTime: false };
    rerender(<EditorStatsBadge wordCount={451} readTime={2} />);
    expect(screen.getByText('451 common.words')).toBeInTheDocument();
  });

  it('renders nothing when both parts are off', () => {
    advancedEditor = { wordCount: false, readingTime: false };
    const { container } = render(<EditorStatsBadge wordCount={450} readTime={2} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both parts for settings saved before the editor section existed', () => {
    advancedEditor = undefined;
    render(<EditorStatsBadge wordCount={3} readTime={1} />);
    expect(
      screen.getByText('3 common.words · manuscript.inspector.readTimeValue:1'),
    ).toBeInTheDocument();
  });
});
