// @vitest-environment node
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { runBounded } from '../../../scripts/hooks/shared.mjs';

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
});
