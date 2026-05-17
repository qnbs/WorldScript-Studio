import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripExifFromImage } from '../../services/imageSanitizer';

// ---------------------------------------------------------------------------
// Mocks — stub jsdom's canvas API
// ---------------------------------------------------------------------------

const mockDrawImage = vi.fn();
const mockToBlob = vi.fn();
const mockGetContext = vi.fn(() => ({ drawImage: mockDrawImage }));

const mockCanvas = {
  width: 0,
  height: 0,
  getContext: mockGetContext,
  toBlob: mockToBlob,
};

const mockBitmap = { width: 100, height: 80, close: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));
  vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLCanvasElement);
});

describe('stripExifFromImage', () => {
  it('returns a blob on success', async () => {
    const fakeBlob = new Blob(['data'], { type: 'image/jpeg' });
    mockToBlob.mockImplementation((cb: (b: Blob) => void) => cb(fakeBlob));

    const file = new File(['pixel'], 'photo.jpg', { type: 'image/jpeg' });
    const result = await stripExifFromImage(file);
    expect(result).toBe(fakeBlob);
    expect(mockDrawImage).toHaveBeenCalledWith(mockBitmap, 0, 0);
  });

  it('sets canvas dimensions from bitmap', async () => {
    const fakeBlob = new Blob(['data'], { type: 'image/jpeg' });
    mockToBlob.mockImplementation((cb: (b: Blob) => void) => cb(fakeBlob));

    const file = new File(['px'], 'photo.png', { type: 'image/png' });
    await stripExifFromImage(file);
    expect(mockCanvas.width).toBe(100);
    expect(mockCanvas.height).toBe(80);
  });

  it('throws when canvas context is unavailable', async () => {
    // QNBS-v3: cast needed — mockReturnValueOnce infers return type from initial mock definition
    mockGetContext.mockReturnValueOnce(null as never);
    mockToBlob.mockImplementation((cb: (b: Blob) => void) => cb(new Blob()));

    const file = new File(['px'], 'photo.jpg', { type: 'image/jpeg' });
    await expect(stripExifFromImage(file)).rejects.toThrow('Canvas context unavailable');
  });

  it('throws when toBlob returns null', async () => {
    mockToBlob.mockImplementation((cb: (b: null) => void) => cb(null));

    const file = new File(['px'], 'photo.jpg', { type: 'image/jpeg' });
    await expect(stripExifFromImage(file)).rejects.toThrow('Failed to sanitize image metadata');
  });
});
