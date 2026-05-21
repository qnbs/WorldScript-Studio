import { describe, expect, it } from 'vitest';
import { snapToGrid } from '../../components/scene-board/plotLayoutUtils';

describe('snapToGrid', () => {
  it('returns value unchanged when snap disabled', () => {
    expect(snapToGrid(17, false)).toBe(17);
  });

  it('snaps to nearest grid line', () => {
    expect(snapToGrid(17, true, 8)).toBe(16);
    expect(snapToGrid(19, true, 8)).toBe(16);
    expect(snapToGrid(20, true, 8)).toBe(24);
  });

  it('respects custom grid size', () => {
    expect(snapToGrid(14, true, 10)).toBe(10);
  });
});
