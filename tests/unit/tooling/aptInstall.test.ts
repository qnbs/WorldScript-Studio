// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  run?: string;
  'timeout-minutes'?: number;
}

const SCRIPT = 'scripts/ci/apt-install.sh';
const AZURE = 'http://azure.archive.ubuntu.com/ubuntu';
const KERNEL = 'https://mirrors.edge.kernel.org/ubuntu';
const ALL_HOSTS = ['azure.archive.ubuntu.com', 'archive.ubuntu.com', 'mirrors.edge.kernel.org'];

const WORKFLOW_DIR = '.github/workflows';
const workflowSteps = readdirSync(WORKFLOW_DIR)
  .filter((file) => /\.ya?ml$/.test(file))
  .flatMap((file) => {
    const workflow = parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as {
      jobs?: Record<string, { steps?: Step[] }>;
    };
    return Object.values(workflow.jobs ?? {}).flatMap((job) =>
      (job.steps ?? []).map((step) => ({ file, step })),
    );
  });
const script = readFileSync(SCRIPT, 'utf8');
const aptSteps = workflowSteps.filter(({ step }) =>
  /apt-get|apt-install\.sh/.test(String(step.run ?? '')),
);

// Stand-ins for the runner commands; `timeout`, `sed` and `tee` stay real. With FAKE_TIMEOUT_SECONDS the fake
// sudo shortens the helper's `timeout --kill-after=N SECONDS` to that many seconds (kill grace 1 s), like a faster clock.
const FAKES: Record<string, string> = {
  sudo: [
    '#!/bin/sh',
    'if [ "$1" = timeout ] && [ -n "$FAKE_TIMEOUT_SECONDS" ]; then',
    '  shift 3',
    '  exec timeout --kill-after=1 "$FAKE_TIMEOUT_SECONDS" "$@"',
    'fi',
    'exec "$@"',
    '',
  ].join('\n'),
  curl: [
    '#!/bin/sh',
    'for url; do :; done',
    'echo "curl $url" >> "$FAKE_CALLS"',
    'for host in $FAKE_UNREACHABLE; do',
    '  case "$url" in *"//$host/"*) echo "curl: (6) Could not resolve host: $host" >&2; exit 6;; esac',
    'done',
    '',
  ].join('\n'),
  'apt-get': [
    '#!/bin/sh',
    'echo "apt-get $*" >> "$FAKE_CALLS"',
    'if [ "$FAKE_APT_HANG" = ignore-term ]; then trap "" TERM; fi',
    'if [ -n "$FAKE_APT_HANG" ]; then exec sleep 30; fi',
    'case " $* " in *" update "*) exit "$FAKE_UPDATE_STATUS";; esac',
    '',
  ].join('\n'),
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runHelper(options: {
  unreachable?: string[];
  updateStatus?: number;
  legacySources?: boolean;
  hang?: 'term' | 'ignore-term';
}) {
  const root = mkdtempSync(join(tmpdir(), 'apt-install-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const etc = join(root, 'apt');
  mkdirSync(bin);
  mkdirSync(join(etc, 'sources.list.d'), { recursive: true });
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  if (options.legacySources) {
    writeFileSync(join(etc, 'sources.list'), `deb ${AZURE} jammy main\n`);
  } else {
    writeFileSync(
      join(etc, 'apt-mirrors.txt'),
      `${AZURE}/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n`,
    );
    writeFileSync(
      join(etc, 'sources.list'),
      'deb mirror+file:/etc/apt/apt-mirrors.txt jammy main\n',
    );
  }
  const calls = join(root, 'calls.log');
  writeFileSync(calls, '');
  // Watchdog: a helper that never stops is killed here and shows up as `signal`, so no test can hang on it.
  const result = spawnSync('bash', [SCRIPT, 'libfoo-dev', 'patchelf'], {
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      APT_INSTALL_ETC: etc,
      FAKE_CALLS: calls,
      FAKE_UNREACHABLE: (options.unreachable ?? []).join(' '),
      FAKE_UPDATE_STATUS: String(options.updateStatus ?? 0),
      FAKE_APT_HANG: options.hang ?? '',
      FAKE_TIMEOUT_SECONDS: options.hang ? '1' : '',
    },
  });
  const read = (file: string) => readFileSync(join(etc, file), 'utf8');
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout}${result.stderr}`,
    calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
    read,
  };
}

const aptCalls = (calls: string[]) => calls.filter((call) => call.startsWith('apt-get '));

// 2026-11-11: no *.ubuntu.com mirror resolved on the runners, and apt-get kept retrying until the 45-minute job timeout (dispatch 43037609935).
describe('apt installs in the release workflow stay bounded', () => {
  it('run through the helper with a step timeout of at most 15 minutes in every workflow', () => {
    // At least the known users must be found, so the scan cannot pass vacuously; another bounded workflow is fine.
    expect([...new Set(aptSteps.map(({ file }) => file))]).toEqual(
      expect.arrayContaining(['ci.yml', 'tauri-build.yml']),
    );
    expect(aptSteps.length).toBeGreaterThanOrEqual(4);
    for (const { file, step } of aptSteps) {
      const label = `${file}: ${step.name}`;
      expect(step.run, label).toMatch(/^bash scripts\/ci\/apt-install\.sh \S/);
      expect(step['timeout-minutes'], label).toBeLessThanOrEqual(15);
    }
  });

  it('make a helper change run the ci.yml gates that use it', () => {
    const ci = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    const filters = ci.match(/grep -qE '\^\([^']*\)' <<< "\$CHANGED"/g) ?? [];
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter).toContain('scripts/ci/apt-install\\.sh$');
    }
  });

  it('keep every probe, both apt calls and their kill grace inside the 15-minute step cap', () => {
    const seconds = (name: string): number => {
      const match = new RegExp(String.raw`^${name}=(\d+)$`, 'm').exec(script);
      expect(match, name).not.toBeNull();
      return Number(match?.[1]);
    };
    const candidates = /^CANDIDATES=\(([^)]*)\)$/m.exec(script)?.[1]?.trim().split(/\s+/) ?? [];
    expect(candidates).toEqual([AZURE, 'https://archive.ubuntu.com/ubuntu', KERNEL]);
    const worstCase =
      candidates.length * seconds('PROBE_SECONDS') +
      seconds('UPDATE_SECONDS') +
      seconds('INSTALL_SECONDS') +
      2 * seconds('KILL_SECONDS');
    expect(worstCase).toBeLessThan(15 * 60);
    expect(script).toContain('--max-time "$PROBE_SECONDS"');
    expect(script).toContain('sudo timeout --kill-after="$KILL_SECONDS" "$seconds" apt-get');
  });

  it('never weaken apt signature or transport checks', () => {
    expect(script).not.toMatch(
      /trusted=yes|AllowInsecureRepositories|AllowUnauthenticated|allow-unauthenticated|Verify-Peer|apt-key|--insecure|\s-k\s/i,
    );
  });
});

describe.skipIf(process.platform !== 'linux')('apt-install.sh on a simulated runner', () => {
  it('keeps the image mirror when it answers and installs with bounded, fail-on-error apt calls', () => {
    const run = runHelper({});
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain(`apt mirror for this job: ${AZURE}`);
    expect(run.output).not.toContain('::warning::');
    expect(run.read('apt-mirrors.txt')).toContain(`${AZURE}/\tpriority:1`);
    expect(aptCalls(run.calls)).toEqual([
      'apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update --error-on=any',
      'apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y libfoo-dev patchelf',
    ]);
  });

  it('switches only this job to the first mirror that answers and names each one that did not', () => {
    const run = runHelper({ unreachable: ['azure.archive.ubuntu.com', 'archive.ubuntu.com'] });
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain(`::warning::apt mirror ${AZURE} did not answer (curl exit 6)`);
    expect(run.output).toContain(
      '::warning::apt mirror https://archive.ubuntu.com/ubuntu did not answer (curl exit 6)',
    );
    expect(run.output).toContain(`apt mirror for this job: ${KERNEL}`);
    expect(run.read('apt-mirrors.txt')).toBe(`${KERNEL}/\n`);
    expect(run.read('sources.list')).toBe('deb mirror+file:/etc/apt/apt-mirrors.txt jammy main\n');
    expect(aptCalls(run.calls)).toHaveLength(2);
  });

  it('rewrites a source list that names the azure mirror directly', () => {
    const run = runHelper({ unreachable: ['azure.archive.ubuntu.com'], legacySources: true });
    expect(run.status, run.output).toBe(0);
    expect(run.read('sources.list')).toBe('deb https://archive.ubuntu.com/ubuntu jammy main\n');
  });

  it('stops before apt with an error naming every mirror when none answers', () => {
    const run = runHelper({ unreachable: ALL_HOSTS });
    expect(run.status).toBe(1);
    expect(run.output).toContain('::error::no apt mirror answered');
    for (const host of ALL_HOSTS) {
      expect(run.output).toContain(`//${host}/ubuntu did not answer`);
    }
    expect(aptCalls(run.calls)).toEqual([]);
    expect(run.read('apt-mirrors.txt')).toContain(`${AZURE}/\tpriority:1`);
  });

  it('fails the step and skips install when apt-get update reports a failed fetch', () => {
    const run = runHelper({ updateStatus: 100 });
    expect(run.status).toBe(100);
    expect(run.output).toContain(
      `::error::apt-get update failed with exit code 100 (mirror ${AZURE})`,
    );
    expect(aptCalls(run.calls)).toHaveLength(1);
  });

  it.each([
    ['stops on TERM', 'term'],
    ['ignores TERM until the kill grace ends', 'ignore-term'],
  ] as const)('stops a hung apt call that %s and reports it as a timeout', (_label, hang) => {
    const run = runHelper({ hang });
    expect(run.signal, 'the helper must stop on its own before the watchdog').toBeNull();
    expect(run.status).toBe(1);
    expect(run.output).toContain('::error::apt-get update did not finish within 300s');
    expect(aptCalls(run.calls)).toHaveLength(1);
  });

  it('refuses to run without packages', () => {
    const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect(result.status).toBe(2);
  });
});
