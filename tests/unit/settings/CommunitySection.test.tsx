/**
 * Tests for components/settings/CommunitySection.tsx
 * QNBS-v3: Mocks SettingsViewContext + domain/ai-core; tests links, model tables.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('@domain/ai-core', () => ({
  WEBLLM_SUPPORTED_MODELS: [
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', vramMB: 900 },
    { id: 'Phi-4-mini-instruct-q4f16_1-MLC', label: 'Phi-4 Mini', vramMB: 2400 },
  ],
  ONNX_SUPPORTED_MODELS: [
    { id: 'Xenova/distilgpt2', label: 'DistilGPT-2', sizeMB: 85 },
    { id: 'HuggingFaceTB/SmolLM2-135M-Instruct', label: 'SmolLM2 135M', sizeMB: 135 },
  ],
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CommunitySection } from '../../../components/settings/CommunitySection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunitySection', () => {
  it('renders the community title', () => {
    render(<CommunitySection />);
    expect(screen.getByText('settings.community.title')).toBeInTheDocument();
  });

  it('renders the discussions link', () => {
    render(<CommunitySection />);
    expect(screen.getByText('settings.community.discussionsLink')).toBeInTheDocument();
  });

  it('renders the GitHub Discussions link with correct href', () => {
    render(<CommunitySection />);
    const link = screen.getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', expect.stringContaining('github.com'));
  });

  it('renders the WebLLM models table section', () => {
    render(<CommunitySection />);
    expect(screen.getByText('settings.community.webllmModels')).toBeInTheDocument();
  });

  it('renders WebLLM model names', () => {
    render(<CommunitySection />);
    expect(screen.getByText('Llama 3.2 1B')).toBeInTheDocument();
    expect(screen.getByText('Phi-4 Mini')).toBeInTheDocument();
  });

  it('renders the ONNX models section', () => {
    render(<CommunitySection />);
    expect(screen.getByText('settings.community.onnxModels')).toBeInTheDocument();
  });

  it('renders ONNX model names', () => {
    render(<CommunitySection />);
    expect(screen.getByText('DistilGPT-2')).toBeInTheDocument();
    expect(screen.getByText('SmolLM2 135M')).toBeInTheDocument();
  });

  it('links open in new tab (target=_blank)', () => {
    render(<CommunitySection />);
    const links = screen.getAllByRole('link');
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
    }
  });
});
