import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const reason = (text) => Object.assign(new Error(text), { reason: text });

function holderIsAlive(directory) {
  try {
    process.kill(Number(readFileSync(join(directory, 'pid'), 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}

// QNBS-v3: one reconcile per machine at a time; a lock whose process is gone is recovered once, a live one stops the second run before it reads anything.
export function acquireLock(directory = join(tmpdir(), 'worldscript-vercel-retention.lock')) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(directory);
      writeFileSync(join(directory, 'pid'), String(process.pid));
      return () => rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw reason('lock-unavailable');
      if (holderIsAlive(directory)) throw reason('retention-already-running');
      rmSync(directory, { recursive: true, force: true });
    }
  }
  throw reason('retention-already-running');
}
