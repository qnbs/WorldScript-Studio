// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { runBounded, runNodeScriptDetailed } from '../../../scripts/hooks/shared.mjs';

describe('bounded hook subprocesses', () => {
  it('does not treat a clean timeout shutdown as a successful run', async () => {
    const result = await runBounded(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 10_000);"],
      { timeoutMs: 100 },
    );

    // QNBS-v3: status is legitimately 0 here (clean exit(0) on SIGTERM); timedOut is the real proof.
    expect(result.timedOut).toBe(true);
  });

  // QNBS-v3: keep nested admission checks in the parent's process group for outer cleanup.
  it('supports foreground children for nested admission checks', async () => {
    const result = await runBounded(process.execPath, ['-e', 'setInterval(() => {}, 10_000);'], {
      timeoutMs: 100,
      detached: false,
    });

    expect(result.timedOut).toBe(true);
    expect(result.status === 0).toBe(false);
  });

  // QNBS-v3: prove repeated parent signals clean detached children without accepting cancellation as pass.
  it('preserves parent cancellation and force-cleans after repeated signals', async () => {
    const resultPromise = runBounded(
      process.execPath,
      ['-e', "process.on('SIGINT', () => {}); setInterval(() => {}, 10_000);"],
      { timeoutMs: 5_000 },
    );
    const firstSignal = setTimeout(() => process.emit('SIGINT'), 50);
    const repeatedSignal = setTimeout(() => process.emit('SIGINT'), 100);

    try {
      const result = await resultPromise;
      expect(result.interrupted).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.status === 0).toBe(false);
    } finally {
      clearTimeout(firstSignal);
      clearTimeout(repeatedSignal);
    }
  });

  describe('runNodeScriptDetailed cwd handling', () => {
    const scratchDirs: string[] = [];
    afterEach(async () => {
      await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    });

    it('preserves an explicit cwd separate from root', async () => {
      const scriptRoot = await mkdtemp(join(tmpdir(), 'worldscript-hook-root-'));
      const workingDir = await mkdtemp(join(tmpdir(), 'worldscript-hook-cwd-'));
      scratchDirs.push(scriptRoot, workingDir);
      await writeFile(
        join(scriptRoot, 'write-marker.mjs'),
        "import { writeFileSync } from 'node:fs'; writeFileSync('marker.txt', 'ok');",
        'utf8',
      );

      const result = await runNodeScriptDetailed('write-marker.mjs', [], {
        root: scriptRoot,
        cwd: workingDir,
      });

      expect(result.status).toBe(0);
      await expect(readFile(join(workingDir, 'marker.txt'), 'utf8')).resolves.toBe('ok');
    });
  });
});
