import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryPandocMarkdownToEpub } from '../../services/pandocTauri';

describe('pandocTauri', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when window is undefined (SSR)', async () => {
    vi.stubGlobal('window', undefined);
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBeNull();
  });

  it('returns null when __TAURI__ is not present (browser)', async () => {
    vi.stubGlobal('window', {});
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBeNull();
  });

  it('returns null when Tauri invoke throws', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.mock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockRejectedValue(new Error('Not available')),
    }));
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBeNull();
  });
});
