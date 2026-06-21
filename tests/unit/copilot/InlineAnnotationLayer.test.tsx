/**
 * Tests for components/copilot/InlineAnnotationLayer.tsx — the editor insight badge.
 * QNBS-v3: gated by enableGlobalCopilot + insight status; only surfaces findings whose params match
 * the active chapter title; clicking force-expands the InsightSection and opens the Copilot.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, mockSetExpanded } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockSetExpanded: vi.fn(),
}));

let mockEnableCopilot = true;
let mockInsights: Array<Record<string, unknown>> = [];
let mockStatus: string = 'idle';

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (sel: (s: { featureFlags: { enableGlobalCopilot: boolean } }) => unknown) =>
    sel({ featureFlags: { enableGlobalCopilot: mockEnableCopilot } }),
}));

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (
    sel: (s: {
      copilotInsights: Array<Record<string, unknown>>;
      copilotInsightStatus: string;
      setCopilotInsightExpanded: (v: boolean) => void;
    }) => unknown,
  ) =>
    sel({
      copilotInsights: mockInsights,
      copilotInsightStatus: mockStatus,
      setCopilotInsightExpanded: mockSetExpanded,
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string, p?: { count?: number }) => `${k}:${p?.count ?? ''}` }),
}));

vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));

vi.mock('../../../features/copilot/copilotSlice', () => ({
  copilotActions: { setOpen: (v: boolean) => ({ type: 'copilot/setOpen', payload: v }) },
}));

import { InlineAnnotationLayer } from '../../../components/copilot/InlineAnnotationLayer';

const finding = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  severity: 'info',
  params: { character: 'Chapter 1' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockEnableCopilot = true;
  mockInsights = [finding()];
  mockStatus = 'idle';
});

describe('InlineAnnotationLayer', () => {
  it('renders a badge when there are findings relevant to the section title', () => {
    render(<InlineAnnotationLayer sectionTitle="Chapter 1" />);
    expect(screen.getByRole('button', { name: 'copilot.annotationCount:1' })).toBeInTheDocument();
  });

  it('returns null when the Copilot flag is off', () => {
    mockEnableCopilot = false;
    const { container } = render(<InlineAnnotationLayer sectionTitle="Chapter 1" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null while insight analysis is running', () => {
    mockStatus = 'running';
    const { container } = render(<InlineAnnotationLayer sectionTitle="Chapter 1" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no findings match the section title', () => {
    const { container } = render(<InlineAnnotationLayer sectionTitle="Chapter 99" />);
    expect(container.firstChild).toBeNull();
  });

  it('matches the section title case-insensitively', () => {
    render(<InlineAnnotationLayer sectionTitle="chapter 1" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('force-expands the insight section and opens the Copilot on click', async () => {
    const user = userEvent.setup();
    render(<InlineAnnotationLayer sectionTitle="Chapter 1" />);
    await user.click(screen.getByRole('button'));
    expect(mockSetExpanded).toHaveBeenCalledWith(true);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'copilot/setOpen', payload: true });
  });
});
