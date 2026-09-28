// @vitest-environment node
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVALUATOR_PATHS,
  MANIFEST_PATH,
  parseManifest,
  sha256,
  TRUST_WORKFLOW_PATH,
  VERIFIER_PATH,
  verifyProtectedTransitions,
} from '../../../scripts/check-protected-transitions.mjs';

// QNBS-v3: real git fixtures exercise the verifier exactly as the base-owned trust workflow runs it (base..head, blobs read as data).
const EVALUATOR_SOURCES: Record<string, string> = {
  'scripts/check-merge-admission.mjs':
    "import { scan } from './check-doc-metrics.mjs';\nexport const run = scan;\n",
  'scripts/check-doc-metrics.mjs':
    "import { locales } from './i18n-locales.mjs';\nimport { count } from './test-metrics.mjs';\nexport const scan = () => [locales, count];\n",
  'scripts/i18n-locales.mjs': 'export const locales = 19;\n',
  'scripts/test-metrics.mjs': 'export const count = 1;\n',
};
const EMPTY_MANIFEST = '{\n  "version": 1,\n  "transitions": []\n}\n';

let root = '';
let base = '';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commitFrom(start: string, edit: () => void): string {
  git('checkout', '--quiet', '--force', '--detach', start);
  edit();
  git('add', '--all');
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'x',
  );
  return git('rev-parse', 'HEAD');
}

function manifestWith(transitions: object[]): string {
  return `${JSON.stringify({ version: 1, transitions }, null, 2)}\n`;
}

function digestOf(content: string): string {
  return sha256(Buffer.from(content));
}

function verify(from: string, to: string): string[] {
  return verifyProtectedTransitions({ baseSha: from, headSha: to, cwd: root });
}

const weakened = (path: string) => `${EVALUATOR_SOURCES[path]}// weakened\n`;
const DOC_METRICS = 'scripts/check-doc-metrics.mjs';
const TEST_METRICS = 'scripts/test-metrics.mjs';

function authorizedBase(transitions: object[]): string {
  return commitFrom(base, () => write(MANIFEST_PATH, manifestWith(transitions)));
}

function docMetricsTransition(to = weakened(DOC_METRICS)) {
  return {
    path: DOC_METRICS,
    from: digestOf(EVALUATOR_SOURCES[DOC_METRICS] ?? ''),
    to: digestOf(to),
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'protected-transitions-'));
  git('init', '--quiet', '--initial-branch=main');
  for (const [path, content] of Object.entries(EVALUATOR_SOURCES)) write(path, content);
  write(VERIFIER_PATH, '// verifier\n');
  write(TRUST_WORKFLOW_PATH, 'name: trust\n');
  write(MANIFEST_PATH, EMPTY_MANIFEST);
  write('README.md', 'readme\n');
  git('add', '--all');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '-m', 'base');
  base = git('rev-parse', 'HEAD');
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('protected evaluator transitions: admitted', () => {
  it('admits a PR that touches no protected file', () => {
    expect(
      verify(
        base,
        commitFrom(base, () => write('README.md', 'changed\n')),
      ),
    ).toEqual([]);
  });

  it('admits a manifest-only PR (it takes effect only after merge)', () => {
    const head = commitFrom(base, () =>
      write(MANIFEST_PATH, manifestWith([docMetricsTransition()])),
    );
    expect(verify(base, head)).toEqual([]);
  });

  it('admits exactly the authorized evaluator edit against the base manifest', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const head = commitFrom(authorized, () => write(DOC_METRICS, weakened(DOC_METRICS)));
    expect(verify(authorized, head)).toEqual([]);
  });
});

describe('protected evaluator transitions: rejected', () => {
  for (const path of EVALUATOR_PATHS) {
    it(`rejects an unauthorized change to ${path}`, () => {
      const head = commitFrom(base, () => write(path, weakened(path)));
      expect(verify(base, head).join('\n')).toMatch(/no base-owned transition authorizes/);
    });
  }

  it('rejects a second protected file beyond the one authorized', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const head = commitFrom(authorized, () => {
      write(DOC_METRICS, weakened(DOC_METRICS));
      write(TEST_METRICS, weakened(TEST_METRICS));
    });
    expect(verify(authorized, head).join('\n')).toMatch(
      /test-metrics\.mjs: no base-owned transition/,
    );
  });

  it('rejects authorized bytes moved onto a different path', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const head = commitFrom(authorized, () => write(TEST_METRICS, weakened(DOC_METRICS)));
    expect(verify(authorized, head).join('\n')).toMatch(
      /test-metrics\.mjs: no base-owned transition/,
    );
  });

  it('rejects head bytes that differ from the authorized digest', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const head = commitFrom(authorized, () =>
      write(DOC_METRICS, `${weakened(DOC_METRICS)}// more\n`),
    );
    expect(verify(authorized, head).join('\n')).toMatch(/differs from the authorized/);
  });

  it('rejects a stale entry once the base moved past its from-digest', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const merged = commitFrom(authorized, () => write(DOC_METRICS, weakened(DOC_METRICS)));
    const head = commitFrom(merged, () =>
      write(DOC_METRICS, `${weakened(DOC_METRICS)}// replay\n`),
    );
    expect(verify(merged, head).join('\n')).toMatch(/authorization is stale/);
  });

  it('rejects restoring the old bytes after the transition merged (no reverse replay)', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const merged = commitFrom(authorized, () => write(DOC_METRICS, weakened(DOC_METRICS)));
    const head = commitFrom(merged, () => write(DOC_METRICS, EVALUATOR_SOURCES[DOC_METRICS] ?? ''));
    expect(verify(merged, head).join('\n')).toMatch(/authorization is stale/);
  });

  it('ignores an authorization the PR adds to its own manifest', () => {
    const head = commitFrom(base, () => {
      write(MANIFEST_PATH, manifestWith([docMetricsTransition()]));
      write(DOC_METRICS, weakened(DOC_METRICS));
    });
    const findings = verify(base, head).join('\n');
    expect(findings).toMatch(/manifest must change alone/);
    expect(findings).toMatch(/check-doc-metrics\.mjs: no base-owned transition/);
  });

  it('rejects the verifier changing together with an evaluator, even if both are authorized', () => {
    const verifierTo = '// verifier v2\n';
    const authorized = authorizedBase([
      docMetricsTransition(),
      { path: VERIFIER_PATH, from: digestOf('// verifier\n'), to: digestOf(verifierTo) },
    ]);
    const head = commitFrom(authorized, () => {
      write(DOC_METRICS, weakened(DOC_METRICS));
      write(VERIFIER_PATH, verifierTo);
    });
    expect(verify(authorized, head).join('\n')).toMatch(
      /must not change in the same PR as an evaluator/,
    );
  });

  it('rejects the trust workflow changing together with an authorized evaluator', () => {
    const authorized = authorizedBase([docMetricsTransition()]);
    const head = commitFrom(authorized, () => {
      write(DOC_METRICS, weakened(DOC_METRICS));
      write(TRUST_WORKFLOW_PATH, 'name: trust v2\n');
    });
    expect(verify(authorized, head).join('\n')).toMatch(
      /must not change in the same PR as an evaluator/,
    );
  });

  it('rejects an unauthorized verifier change', () => {
    const head = commitFrom(base, () => write(VERIFIER_PATH, '// verifier gutted\n'));
    expect(verify(base, head).join('\n')).toMatch(
      /check-protected-transitions\.mjs: no base-owned transition/,
    );
  });

  it('rejects deleting an evaluator', () => {
    const head = commitFrom(base, () => unlinkSync(join(root, 'scripts/i18n-locales.mjs')));
    expect(verify(base, head).join('\n')).toMatch(/i18n-locales\.mjs: status D/);
  });

  it('rejects renaming an evaluator', () => {
    const head = commitFrom(base, () =>
      git('mv', 'scripts/check-merge-admission.mjs', 'scripts/cma.mjs'),
    );
    expect(verify(base, head).join('\n')).toMatch(/check-merge-admission\.mjs: status D/);
  });

  it('rejects replacing an evaluator with a symlink', () => {
    const head = commitFrom(base, () => {
      unlinkSync(join(root, TEST_METRICS));
      symlinkSync('../README.md', join(root, TEST_METRICS));
    });
    expect(verify(base, head).join('\n')).toMatch(/test-metrics\.mjs: status T/);
  });

  it('rejects a mode change even with identical bytes', () => {
    const head = commitFrom(base, () => chmodSync(join(root, DOC_METRICS), 0o755));
    expect(verify(base, head).join('\n')).toMatch(/mode 100644→100755/);
  });

  it('rejects an authorized importer edit that pulls in an unprotected substitute', () => {
    const redirected =
      "import { locales } from './i18n-locales.mjs';\nimport { count } from './tm2.mjs';\nexport const scan = () => [locales, count];\n";
    const authorized = authorizedBase([docMetricsTransition(redirected)]);
    const head = commitFrom(authorized, () => {
      write('scripts/tm2.mjs', 'export const count = 0;\n');
      write(DOC_METRICS, redirected);
    });
    expect(verify(authorized, head).join('\n')).toMatch(
      /reaches unprotected files: scripts\/tm2\.mjs/,
    );
  });

  it('rejects a trust-workflow-only PR that is not authorized (e.g. dropping the verifier call)', () => {
    const head = commitFrom(base, () =>
      write(TRUST_WORKFLOW_PATH, 'name: trust without verifier\n'),
    );
    expect(verify(base, head).join('\n')).toMatch(
      /reviewer-governance-trust\.yml: no base-owned transition/,
    );
  });

  it('admits an exactly authorized trust-workflow-only change', () => {
    const next = 'name: trust v2\n';
    const authorized = authorizedBase([
      { path: TRUST_WORKFLOW_PATH, from: digestOf('name: trust\n'), to: digestOf(next) },
    ]);
    expect(
      verify(
        authorized,
        commitFrom(authorized, () => write(TRUST_WORKFLOW_PATH, next)),
      ),
    ).toEqual([]);
  });

  for (const [label, source, pattern] of [
    [
      'a bare package import',
      "import leftpad from 'left-pad';\nexport const count = 1;\n",
      /imports non-builtin 'left-pad'/,
    ],
    [
      'a non-literal dynamic import',
      'const m = "./x.mjs";\nexport const load = () => import(m);\n',
      /non-literal dynamic import/,
    ],
    ['require()', 'const fs = require("node:fs");\nexport const count = 1;\n', /uses require\(\)/],
    [
      'createRequire',
      "import { createRequire } from 'node:module';\nexport const r = createRequire(import.meta.url);\n",
      /uses createRequire/,
    ],
  ] as const) {
    it(`rejects an authorized evaluator edit that adds ${label}`, () => {
      const authorized = authorizedBase([
        {
          path: TEST_METRICS,
          from: digestOf(EVALUATOR_SOURCES[TEST_METRICS] ?? ''),
          to: digestOf(source),
        },
      ]);
      const head = commitFrom(authorized, () => write(TEST_METRICS, source));
      expect(verify(authorized, head).join('\n')).toMatch(pattern);
    });
  }

  it('admits an authorized evaluator edit that only adds a node: builtin import', () => {
    const source = "import { EOL } from 'node:os';\nexport const count = EOL.length;\n";
    const authorized = authorizedBase([
      {
        path: TEST_METRICS,
        from: digestOf(EVALUATOR_SOURCES[TEST_METRICS] ?? ''),
        to: digestOf(source),
      },
    ]);
    expect(
      verify(
        authorized,
        commitFrom(authorized, () => write(TEST_METRICS, source)),
      ),
    ).toEqual([]);
  });

  it('rejects a head manifest that is malformed in a manifest-only PR', () => {
    const head = commitFrom(base, () =>
      write(MANIFEST_PATH, manifestWith([{ path: 'scripts/*', from: 'a', to: 'b' }])),
    );
    expect(verify(base, head).join('\n')).toMatch(/invalid protected transition entry/);
  });

  it('fails closed on non-commit inputs', () => {
    expect(verifyProtectedTransitions({ baseSha: 'main', headSha: undefined, cwd: root })).toEqual([
      'base and head must be full 40-character commit ids',
    ]);
  });
});

describe('protected-transition manifest schema', () => {
  const entry = { path: DOC_METRICS, from: 'a'.repeat(64), to: 'b'.repeat(64) };

  it('accepts the committed empty manifest shape', () => {
    expect(parseManifest(EMPTY_MANIFEST)).toEqual({ transitions: [] });
  });

  it('rejects wildcard, unknown, manifest-self and trusted-root paths', () => {
    for (const path of [
      'scripts/*.mjs',
      'scripts/other.mjs',
      MANIFEST_PATH,
      'scripts/workflow-policy-check.mjs',
    ]) {
      expect(parseManifest(manifestWith([{ ...entry, path }])).error).toMatch(
        /invalid protected transition entry/,
      );
    }
  });

  it('rejects duplicate paths, no-op transitions, extra keys and bad digests', () => {
    expect(parseManifest(manifestWith([entry, entry])).error).toMatch(/more than once/);
    expect(parseManifest(manifestWith([{ ...entry, to: entry.from }])).error).toMatch(/invalid/);
    expect(parseManifest(manifestWith([{ ...entry, pr: 1 }])).error).toMatch(/invalid/);
    expect(parseManifest(manifestWith([{ ...entry, from: 'A'.repeat(64) }])).error).toMatch(
      /invalid/,
    );
    expect(parseManifest('{"version":2,"transitions":[]}').error).toMatch(/must be/);
    expect(parseManifest('not json').error).toMatch(/not valid JSON/);
  });
});
