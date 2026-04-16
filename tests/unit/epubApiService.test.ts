import { describe, it, expect, vi } from 'vitest';
import { exportEpub } from '../../services/epubApiService';

// Mock JSZip since we're testing logic, not zip internals
vi.mock('jszip', () => {
  const blobResult = new Blob(['mock-epub'], { type: 'application/epub+zip' });
  function MockJSZip(this: Record<string, unknown>) {
    this['file'] = () => this;
    this['folder'] = () => this;
    this['generateAsync'] = () => Promise.resolve(blobResult);
  }
  return { default: MockJSZip };
});

describe('epubApiService', () => {
  it('exports a valid epub blob', async () => {
    // Mock URL and anchor methods for download
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: mockCreateObjectURL,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: mockRevokeObjectURL,
      writable: true,
    });

    const mockAnchor = document.createElement('a');
    const mockClick = vi.fn();
    vi.spyOn(mockAnchor, 'click').mockImplementation(mockClick);
    vi.spyOn(mockAnchor, 'remove').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor);

    await exportEpub({
      title: 'Test Buch',
      author: 'Test Autor',
      chapters: [{ title: 'Kapitel 1', content: 'Inhalt des ersten Kapitels.' }],
    });

    expect(mockClick).toHaveBeenCalledOnce();
    // Service sanitizes spaces to underscores in filename
    expect(mockAnchor.download).toBe('Test_Buch.epub');
  });

  it('uses provided language', async () => {
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:url');
    Object.defineProperty(URL, 'createObjectURL', {
      value: mockCreateObjectURL,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      writable: true,
    });
    const mockAnchor2 = document.createElement('a');
    const mockClick = vi.fn();
    vi.spyOn(mockAnchor2, 'click').mockImplementation(mockClick);
    vi.spyOn(mockAnchor2, 'remove').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor2);

    await exportEpub({
      title: 'My Book',
      author: 'Author',
      chapters: [],
      lang: 'en',
    });

    expect(mockClick).toHaveBeenCalledOnce();
  });
});
