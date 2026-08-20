import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseImportedProjectJson } from '../../services/projectImportSchema';

// QNBS-v3: path.join (not `new URL(relative, import.meta.url)`) — Vite's static analysis rewrites
// that exact call shape into a dev-server asset URL for .json targets, breaking fileURLToPath.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(currentDir, '../fixtures/project-golden-masters');

// QNBS-v3: same fixture files as crates/worldscript-project/tests/fixtures_test.rs — this freezes
// current Zod accept/reject behavior as the golden-master oracle the Rust side is compared against.
function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

describe('project golden masters (Rust parity oracle)', () => {
  it('accepts empty-project.json', () => {
    const parsed = parseImportedProjectJson(readFixture('empty-project.json'));
    expect(parsed.title).toBe('Empty Project');
  });

  it('accepts typical-project.json', () => {
    const parsed = parseImportedProjectJson(readFixture('typical-project.json'));
    expect(parsed.characters).toHaveLength(2);
    expect(parsed.manuscript).toHaveLength(2);
  });

  it('accepts large-project.json and preserves counts', () => {
    const parsed = parseImportedProjectJson(readFixture('large-project.json'));
    expect(parsed.manuscript).toHaveLength(250);
    expect(parsed.characters).toHaveLength(30);
  });

  it('rejects missing-title.json (title is required)', () => {
    expect(() => parseImportedProjectJson(readFixture('missing-title.json'))).toThrow(
      /Invalid project file/,
    );
  });

  it('rejects truncated.json without throwing an unstructured error', () => {
    expect(() => parseImportedProjectJson(readFixture('truncated.json'))).toThrow(
      /Invalid project file/,
    );
  });
});
