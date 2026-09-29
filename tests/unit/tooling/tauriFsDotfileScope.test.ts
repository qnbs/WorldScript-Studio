// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const capability = JSON.parse(
  readFileSync(join(root, 'src-tauri/capabilities/default.json'), 'utf8'),
) as { permissions: Array<string | { identifier: string; allow?: Array<{ path?: string }> }> };

// Path suffixes that are appended to a regular file name (project.json.lock, image.png, …).
// They never form a whole path component, so tauri-plugin-fs's leading-dot rule does not apply.
const SUFFIX_LITERALS = new Set(['.json', '.md', '.markdown', '.lock', '.png']);

// The exact store location of every desktop dotfile (projectFsStore / assetFsStore). A new
// dotfile must be added here with its real directory, so the guard proves the path that the store
// actually uses rather than any path that merely ends with the same name.
const DOTFILE_SCOPE: Record<string, string> = {
  '.incarnation': '$APPDATA/projects/*/.incarnation',
  '.legacy-owner': '$APPDATA/images/.legacy-owner',
};

// Every fs operation the desktop stores perform on their own files (fsCore writeTextFileAtomic
// writes `<path>.tmp-<id>`, renames it over the target and removes it on failure).
const FILE_PERMISSIONS = [
  'fs:allow-read-text-file',
  'fs:allow-write-text-file',
  'fs:allow-exists',
  'fs:allow-remove',
  'fs:allow-rename',
];

function dotfileNamesInFsStores(): string[] {
  const dir = join(root, 'services/fs');
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const match of source.matchAll(/'(\.[A-Za-z][\w-]*)'/g)) {
      if (!SUFFIX_LITERALS.has(match[1] as string)) names.add(match[1] as string);
    }
  }
  return [...names].sort();
}

function allowedPaths(identifier: string): string[] {
  const permission = capability.permissions.find(
    (entry) => typeof entry === 'object' && entry.identifier === identifier,
  );
  if (!permission || typeof permission === 'string') return [];
  return (permission.allow ?? []).map((entry) => entry.path ?? '');
}

describe('Tauri fs capability covers desktop dotfiles (#907)', () => {
  it('knows the exact store path of every dotfile the stores use', () => {
    expect(dotfileNamesInFsStores()).toEqual(Object.keys(DOTFILE_SCOPE).sort());
  });

  // QNBS-v3: tauri-plugin-fs defaults requireLiteralLeadingDot to true on Linux/macOS, so `$APPDATA/**` never matches a path component that starts with "."; each dotfile needs a pattern with a literal leading dot at its real location, or saving/loading fails there with "forbidden path" while Windows and mocked tests still pass.
  it.each(FILE_PERMISSIONS)(
    '%s grants every dotfile and its atomic-write temp file at the store path',
    (identifier) => {
      const paths = allowedPaths(identifier);
      for (const pattern of Object.values(DOTFILE_SCOPE)) {
        expect(paths, `${identifier} → ${pattern}`).toContain(pattern);
        expect(paths, `${identifier} → ${pattern}.tmp-*`).toContain(`${pattern}.tmp-*`);
      }
    },
  );

  it('keeps every fs permission path inside the app data directory', () => {
    for (const identifier of FILE_PERMISSIONS) {
      for (const path of allowedPaths(identifier)) {
        expect(path === '$APPDATA' || path.startsWith('$APPDATA/'), path).toBe(true);
      }
    }
  });
});
