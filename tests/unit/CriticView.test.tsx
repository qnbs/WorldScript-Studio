import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CriticView } from '../../components/CriticView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAnalyzeText = vi.fn();
const mockDetectPlotHoles = vi.fn();

vi.mock('../../hooks/useCriticView', () => ({
  useCriticView: vi.fn(() => ({
    t: (k: string) => k,
    analysisResult: null,
    isAnalyzing: false,
    analyzeText: mockAnalyzeText,
    detectPlotHoles: mockDetectPlotHoles,
    language: 'en',
  })),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    setTranscript: vi.fn(),
  })),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CriticView', () => {
  it('renders without throwing', () => {
    expect(() => render(<CriticView />)).not.toThrow();
  });

  it('shows the title', () => {
    render(<CriticView />);
    expect(screen.getByText('critic.title')).toBeTruthy();
  });

  it('shows the analyze button', () => {
    render(<CriticView />);
    expect(screen.getByRole('button', { name: 'critic.analyzeButton' })).toBeTruthy();
  });

  it('shows the detect plot holes button', () => {
    render(<CriticView />);
    expect(screen.getByRole('button', { name: 'critic.detectPlotHoles' })).toBeTruthy();
  });

  it('shows no results placeholder when analysisResult is null', () => {
    render(<CriticView />);
    expect(screen.getByText('critic.noResults')).toBeTruthy();
  });

  it('shows analysis result when provided', async () => {
    const { useCriticView } = await import('../../hooks/useCriticView');
    vi.mocked(useCriticView).mockReturnValueOnce({
      t: (k: string) => k,
      analysisResult: 'Your writing is excellent!',
      isAnalyzing: false,
      analyzeText: mockAnalyzeText,
      detectPlotHoles: mockDetectPlotHoles,
      language: 'en',
    } as never);
    render(<CriticView />);
    expect(screen.getByText('Your writing is excellent!')).toBeTruthy();
  });

  it('calls detectPlotHoles when plot holes button is clicked', () => {
    render(<CriticView />);
    fireEvent.click(screen.getByRole('button', { name: 'critic.detectPlotHoles' }));
    expect(mockDetectPlotHoles).toHaveBeenCalledOnce();
  });
});
