import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isDesktop: { value: true },
  convertMarkdownToEpub: vi.fn(async (_markdown: string): Promise<Uint8Array | null> => null),
}));

vi.mock('../../services/desktopPlatform', () => ({
  get desktopPlatform() {
    return {
      runtime: {
        get isDesktop() {
          return h.isDesktop.value;
        },
        os: null,
      },
      tasks: { convertMarkdownToEpub: (markdown: string) => h.convertMarkdownToEpub(markdown) },
    };
  },
}));

import { tryPandocMarkdownToEpub } from '../../services/pandocTauri';

describe('pandocTauri', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isDesktop.value = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when not running on desktop', async () => {
    h.isDesktop.value = false;
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBeNull();
    expect(h.convertMarkdownToEpub).not.toHaveBeenCalled();
  });

  it('returns the converted bytes on desktop', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    h.convertMarkdownToEpub.mockResolvedValueOnce(bytes);
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBe(bytes);
    expect(h.convertMarkdownToEpub).toHaveBeenCalledWith('# Hello');
  });

  it('returns null when the platform adapter reports failure', async () => {
    h.convertMarkdownToEpub.mockResolvedValueOnce(null);
    const result = await tryPandocMarkdownToEpub('# Hello');
    expect(result).toBeNull();
  });
});
