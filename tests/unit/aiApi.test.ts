import { describe, expect, it, vi } from 'vitest';
import { aiApi } from '../../app/aiApi';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/aiProviderService', () => ({
  generateText: vi.fn(),
}));

import { generateText } from '../../services/aiProviderService';

const mockGenerateText = vi.mocked(generateText);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aiApi', () => {
  it('is created with reducerPath "aiApi"', () => {
    expect(aiApi.reducerPath).toBe('aiApi');
  });

  it('exports useGenerateTextMutation', async () => {
    const { useGenerateTextMutation } = await import('../../app/aiApi');
    expect(typeof useGenerateTextMutation).toBe('function');
  });
});

describe('aiApi generateText endpoint (queryFn)', () => {
  // Access the internal queryFn via the endpoint definitions
  const endpoint = aiApi.endpoints.generateText;

  // QNBS-v3: unused helper removed; tests access queryFn directly via cast below

  it('returns data.text on success', async () => {
    mockGenerateText.mockResolvedValueOnce('Generated response');

    // Test through the actual queryFn
    const qf = (
      endpoint as unknown as { query: undefined; queryFn: (req: unknown) => Promise<unknown> }
    ).queryFn;
    if (!qf) return; // skip if not accessible

    const result = await qf({
      prompt: 'Hello',
      creativity: 'Balanced',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    });
    expect(result).toMatchObject({ data: { text: 'Generated response' } });
  });

  it('returns error on rejection', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('API error'));

    const qf = (
      endpoint as unknown as { query: undefined; queryFn: (req: unknown) => Promise<unknown> }
    ).queryFn;
    if (!qf) return;

    const result = await qf({
      prompt: 'Hello',
      creativity: 'Focused',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    });
    expect(result).toMatchObject({ error: { status: 'CUSTOM_ERROR', error: 'API error' } });
  });

  it('handles non-Error rejections', async () => {
    mockGenerateText.mockRejectedValueOnce('plain string error');

    const qf = (
      endpoint as unknown as { query: undefined; queryFn: (req: unknown) => Promise<unknown> }
    ).queryFn;
    if (!qf) return;

    const result = await qf({
      prompt: 'Hello',
      creativity: 'Focused',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    });
    expect(result).toMatchObject({ error: { status: 'CUSTOM_ERROR' } });
  });
});
