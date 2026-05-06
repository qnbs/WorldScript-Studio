export async function stripExifFromImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable for EXIF sanitization.');
  }

  // Re-encode pixel data to remove metadata (EXIF/IPTC/XMP).
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
  if (!blob) {
    throw new Error('Failed to sanitize image metadata.');
  }
  return blob;
}
