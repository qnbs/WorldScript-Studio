import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../services/themeCustomization';

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

describe('status fill label contrast', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(`\n${selector} {`);
    const body = css.slice(start, css.indexOf('\n}', start));
    return Object.fromEntries(
      [...body.matchAll(/(--sc-[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, k = '', v = '']) => [k, v]),
    );
  };
  const themes: Record<string, string[]> = {
    dark: [':root'],
    light: [':root', '.light-theme'],
    'sepia-light': [':root', '.light-theme', '.appearance-sepia'],
    'sepia-dark': [':root', '.appearance-sepia', '.dark-theme.appearance-sepia'],
  };

  it.each(Object.entries(themes))('%s: labels on status fills reach 4.5:1', (_name, selectors) => {
    const tokens = Object.assign({}, ...selectors.map(block)) as Record<string, string>;
    const label = tokens['--sc-text-on-status'] ?? '';
    const weak = ['danger', 'success', 'warning', 'info']
      .map((status) => tokens[`--sc-${status}-fg`] ?? '')
      .filter((fill) => contrastRatio({ foreground: label, background: fill }) < 4.5);
    expect(weak).toEqual([]);
  });
});
