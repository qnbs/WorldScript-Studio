import { describe, expect, it } from 'vitest';

describe('lazy heavy modules', () => {
  it('CharacterGraphView module does not statically import react-force-graph-2d at top level', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../components/CharacterGraphView.tsx',
    );
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/^import\s+ForceGraph2D\s+from\s+['"]react-force-graph-2d['"]/m);
    expect(src).toContain('lazy(');
  });

  it('SceneBoardView uses lazy for PlotCanvas', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../components/SceneBoardView.tsx',
    );
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain("import('./scene-board/PlotCanvas')");
  });
});
