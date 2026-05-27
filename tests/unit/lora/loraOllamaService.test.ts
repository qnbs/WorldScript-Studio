/**
 * Tests for services/lora/loraOllamaService.ts
 * QNBS-v3: Mock fetch; verify Modelfile generation and API calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteOllamaModel,
  generateModelfile,
  listOllamaModels,
} from '../../../services/lora/loraOllamaService';

describe('generateModelfile', () => {
  it('produces correct FROM, ADAPTER, and SYSTEM lines', () => {
    const mf = generateModelfile('llama-3.2-7b', '/path/adapter.gguf', 'HemingwayStyle');
    expect(mf).toContain('FROM llama-3.2-7b');
    expect(mf).toContain('ADAPTER /path/adapter.gguf');
    expect(mf).toContain('HemingwayStyle');
    expect(mf).toContain('SYSTEM');
  });
});

describe('listOllamaModels', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3.2', modified_at: '2026-01-01', size: 4_000_000_000, digest: 'abc' },
          {
            name: 'storycraft-lora-style',
            modified_at: '2026-01-02',
            size: 200_000_000,
            digest: 'def',
          },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns model list from Ollama API', async () => {
    const models = await listOllamaModels('http://localhost:11434');
    expect(models).toHaveLength(2);
    expect(models[0]!.name).toBe('llama3.2');
  });

  it('returns empty array on fetch failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const models = await listOllamaModels('http://localhost:11434');
    expect(models).toEqual([]);
  });
});

describe('deleteOllamaModel', () => {
  it('calls DELETE /api/delete with model name', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    await deleteOllamaModel('storycraft-lora-style', 'http://localhost:11434');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/delete',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
