import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryPandocMarkdownToEpub } from '../../services/pandocTauri';

// QNBS-v3: Mock must be at top level per vitest requirements
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

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
    const { invoke } = await import('@tauri-apps/api/core');
    vi.stubGlobal('window', { __TAURI__: {} });
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Not available'));
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBeNull();
  });
});
