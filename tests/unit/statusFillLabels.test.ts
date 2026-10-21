import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A custom primary color (#702) re-points --sc-text-on-accent to stay readable on that primary.
 * Fixed status fills (danger/success/warning/info/error) must use --sc-text-on-status instead, or
 * their labels would follow the user's primary color.
 */

const COMPONENTS = resolve(__dirname, '../../components');
const STATUS_FILL = /bg-\[var\(--sc-(?:(?:danger|success|warning|info)-fg|error)\)\]/;
const ACCENT_LABEL = 'text-[var(--sc-text-on-accent)]';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('status fill labels', () => {
  it('never pairs a status fill with the accent label color', () => {
    const offenders = tsxFiles(COMPONENTS).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          STATUS_FILL.test(line) && line.includes(ACCENT_LABEL)
            ? [`${file.slice(COMPONENTS.length + 1)}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
