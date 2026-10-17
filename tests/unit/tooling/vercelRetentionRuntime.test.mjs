import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertRuntime, main } from '../../../scripts/vercel-retention/cli.mjs';
import {
  makeDeps,
  standardWorld,
  withRetentionRuntime,
} from './support/vercelRetentionFixture.mjs';

const cli = fileURLToPath(new URL('../../../scripts/vercel-retention/cli.mjs', import.meta.url));

test('the operator contract matches .nvmrc without narrowing application engines or CI', () => {
  assert.equal(readFileSync(new URL('../../../.nvmrc', import.meta.url), 'utf8').trim(), '22');
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.19.0');
  for (const version of ['22.19.0', '22.19.1', '22.23.3', '22.100.0'])
    assert.doesNotThrow(() => assertRuntime(version));
  for (const version of [
    null,
    '',
    'unknown',
    'v22.23.3',
    '22.18.99',
    '22.19',
    '22.19.0-rc.1',
    '22.19.0\n',
    '22.019.0',
    '22.19.00',
    '22.19.9007199254740992',
    '22.9007199254740992.0',
    '20.19.0',
    '21.0.0',
    '23.0.0',
    '24.18.0',
  ]) {
    assert.throws(() => assertRuntime(version), { reason: 'runtime-mismatch' });
  }
});

function guardedChild(argv, version) {
  // QNBS-v3: test-only preload instruments every CLI/lock boundary and runner resolution; production has no runtime override or environment escape hatch.
  const preload = `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const calls = { child: 0, lock: 0, runner: 0, fetch: 0 };
    const deny = (kind) => () => { calls[kind]++; throw new Error('unexpected-side-effect'); };
    cp.execFileSync = deny('child');
    for (const key of ['writeFileSync', 'linkSync', 'renameSync', 'rmSync']) fs[key] = deny('lock');
    globalThis.fetch = deny('fetch');
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === './apply.mjs') { calls.runner++; throw new Error('runner-loaded'); }
      return next(specifier, context);
    }});
    ${version === undefined ? '' : `Object.defineProperty(process.versions, 'node', {value: ${JSON.stringify(version)}});`}
    process.on('exit', () => process.stderr.write('GUARD_CALLS ' + JSON.stringify(calls) + '\\n'));
  `;
  const result = spawnSync(
    process.execPath,
    [`--import=data:text/javascript,${encodeURIComponent(preload)}`, cli, ...argv],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const counts = /GUARD_CALLS (\{[^\n]+\})/.exec(result.stderr);
  assert.ok(counts, result.stderr);
  assert.deepEqual(JSON.parse(counts[1]), { child: 0, lock: 0, runner: 0, fetch: 0 });
  return result.stderr;
}

for (const mode of ['dry-run', 'reconcile']) {
  test(`${mode} rejects unsupported and malformed runtimes before all external boundaries`, () => {
    for (const version of [
      '24.18.0',
      '20.19.0',
      '21.9.0',
      '23.0.0',
      '22.18.9',
      'private-invalid-value',
    ]) {
      const stderr = guardedChild([mode], version);
      assert.match(stderr, /RETENTION_STOP: runtime-mismatch/);
      assert.ok(!stderr.includes(version));
    }
  });

  test(`${mode} accepts supported runtime with mocked provider and unchanged source checks`, async () => {
    const world = standardWorld();
    const lines = [];
    await withRetentionRuntime(() =>
      main([mode], makeDeps(world), { log: (line) => lines.push(line) }),
    );
    const summary = JSON.parse(
      lines.find((line) => line.startsWith('RETENTION_SUMMARY ')).slice(18),
    );
    assert.equal(summary.stop, null);
    assert.equal(summary.writeAttempts, mode === 'dry-run' ? 0 : world.writes.length);
    assert.equal(world.released, mode === 'dry-run' ? 0 : 1);
    assert.ok(world.calls.some((call) => call.startsWith('vercel api')));
  });
}

test('the actual matrix runtime refuses before tools, locks and runner imports', () => {
  const supported = /^22\./.test(process.versions.node);
  const argv = supported ? ['--execute'] : ['reconcile'];
  const stderr = guardedChild(argv);
  assert.ok(
    stderr.includes(`RETENTION_STOP: ${supported ? 'invalid-arguments' : 'runtime-mismatch'}`),
  );
});

test('supported runtime still rejects a modified source before provider calls or locks', async () => {
  const world = standardWorld();
  world.differs = true;
  await assert.rejects(
    withRetentionRuntime(() => main(['reconcile'], makeDeps(world), { log() {} })),
    { reason: 'runner-source-differs-from-main' },
  );
  assert.ok(world.calls.every((call) => call.startsWith('git ')));
  assert.deepEqual(world.writes, []);
  assert.equal(world.released, 0);
});
