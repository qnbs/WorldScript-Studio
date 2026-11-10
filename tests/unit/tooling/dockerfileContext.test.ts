import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkDockerfileContext,
  dockerfileCopySources,
  dockerignoreExcludes,
} from '../../../scripts/check-dockerfile-context.mjs';

// #1223: the v1.29.4 tag run failed at `COPY patches/ ./patches/` ("/patches": not found) because #1149 had removed the last patch.
const read = (name: string) => readFileSync(resolve(name), 'utf8');

describe('the Dockerfile build context', () => {
  it('only copies sources that exist and are not excluded by .dockerignore', () => {
    const result = checkDockerfileContext({
      dockerfile: read('Dockerfile'),
      dockerignore: read('.dockerignore'),
      exists: (path) => existsSync(resolve(path)),
    });

    expect(result.errors).toEqual([]);
    expect(result.sources).toEqual(
      expect.arrayContaining(['package.json', 'pnpm-lock.yaml', 'packages/', '.']),
    );
  });

  it('reproduces the v1.29.4 failure: a COPY source that is not in the context', () => {
    const dockerfile = [
      'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./',
      'COPY patches/ ./patches/',
      'COPY packages/ ./packages/',
    ].join('\n');
    const present = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages']);
    const result = checkDockerfileContext({
      dockerfile,
      dockerignore: '',
      exists: (path) => present.has(path),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['COPY/ADD source is missing from the build context: patches/']);
  });

  it('rejects a source that .dockerignore excludes', () => {
    const result = checkDockerfileContext({
      dockerfile: 'COPY packages/ ./packages/\nCOPY nginx.conf /etc/nginx/conf.d/default.conf',
      dockerignore: 'node_modules\npackages\n',
      exists: () => true,
    });

    expect(result.errors).toEqual(['COPY/ADD source is excluded by .dockerignore: packages/']);
  });
});

describe('Dockerfile COPY and ADD parsing', () => {
  it('collects context sources, skips stage copies, flags, comments and continuations', () => {
    const { sources, errors } = dockerfileCopySources(
      [
        '# COPY ignored.txt ./',
        'COPY --chown=1:1 a.txt b/ ./dest/',
        'COPY --from=builder /app/dist /usr/share/nginx/html',
        'ADD tool.tar \\',
        '  ./opt/',
        'RUN echo COPY not-an-instruction ./',
      ].join('\n'),
    );

    expect(errors).toEqual([]);
    expect(sources).toEqual(['a.txt', 'b/', 'tool.tar']);
  });

  it.each([
    ['a wildcard source', 'COPY src/*.json ./', /unsupported COPY\/ADD source/],
    ['a variable source', 'COPY $FILE ./', /unsupported COPY\/ADD source/],
    ['a URL source', 'ADD https://example.test/x.tgz /x', /unsupported COPY\/ADD source/],
    ['the JSON array form', 'COPY ["a b", "./"]', /unsupported COPY\/ADD form/],
    ['an instruction without a destination', 'COPY only-one', /unsupported COPY\/ADD form/],
  ])('fails closed on %s', (_name, dockerfile, error) => {
    expect(dockerfileCopySources(dockerfile).errors.join('\n')).toMatch(error);
  });
});

describe('.dockerignore matching', () => {
  it.each([
    ['node_modules', 'node_modules', true],
    ['dist', 'dist/index.html', true],
    ['*.log', 'build.log', true],
    ['*.log', 'logs/build.log', false],
    ['.env*', '.env.production', true],
    ['/packages/', 'packages', true],
    ['packages', 'packages-extra', false],
    ['src-tauri/target', 'src-tauri', false],
  ])('pattern %s against %s is %s', (pattern, path, expected) => {
    expect(dockerignoreExcludes(`${pattern}\n`, path)).toBe(expected);
  });

  it('lets a later negation re-include and the last matching pattern win', () => {
    expect(dockerignoreExcludes('.env*\n!.env.example\n', '.env.example')).toBe(false);
    expect(dockerignoreExcludes('.env*\n!.env.example\n', '.env.local')).toBe(true);
    expect(dockerignoreExcludes('!keep\nkeep\n', 'keep')).toBe(true);
  });
});
