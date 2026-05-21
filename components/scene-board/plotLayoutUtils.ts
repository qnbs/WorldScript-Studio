/** Grid snap helper for Plot Board canvas (testable, no React deps). */
export function snapToGrid(value: number, snap: boolean, gridSize = 8): number {
  if (!snap) return value;
  return Math.round(value / gridSize) * gridSize;
}
