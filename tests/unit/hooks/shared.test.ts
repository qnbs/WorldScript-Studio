// @vitest-environment node
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { runBounded } from '../../../scripts/hooks/shared.mjs';

describe('bounded hook subprocesses', () => {
  it('does not treat a clean timeout shutdown as a successful run', async () => {
    const startedAt = performance.now();
    const result = await runBounded(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 10_000);"],
      { timeoutMs: 100 },
    );

    expect(result.timedOut).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(900);
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
