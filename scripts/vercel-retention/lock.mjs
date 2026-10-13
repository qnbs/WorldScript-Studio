import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ATTEMPTS = 3;
const reason = (text) => Object.assign(new Error(text), { reason: text });
const suffix = () => `${process.pid}.${randomBytes(4).toString('hex')}`;

// Returns the holder's process id, null when there is no lock file, and 0 when the file does not hold a process id.
function holderOf(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function tryLink(mine, path) {
  try {
    linkSync(mine, path);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw reason('lock-unavailable');
  }
}

// QNBS-v3: a stale lock is removed by renaming it away and checking that what was moved is the dead holder seen earlier; if another process replaced it in between, the moved lock is put back, and if that fails too the moved file is kept and the run stops, so a live holder's lock is never deleted on the strength of an old observation.
export function reclaim(path, dead, restore = tryLink) {
  const moved = `${path}.stale.${suffix()}`;
  try {
    renameSync(path, moved);
  } catch {
    return;
  }
  if (holderOf(moved) !== dead && !restore(moved, path)) throw reason('retention-already-running');
  rmSync(moved, { force: true });
}

// A live holder, or a file that is not a process id, stops the run; a dead holder is reclaimed and the caller tries again.
function settle(path) {
  const holder = holderOf(path);
  if (holder === 0) throw reason('retention-lock-unreadable');
  if (holder === null) return;
  if (isAlive(holder)) throw reason('retention-already-running');
  reclaim(path, holder);
}

const releaser = (path) => () => {
  if (holderOf(path) === process.pid) rmSync(path, { force: true });
};

// QNBS-v3: the pid file is created complete under a private name and linked into place atomically, so no process ever sees a lock without its holder; one reconcile per machine at a time, and a second run stops before it reads anything.
export function acquireLock(path = join(tmpdir(), 'worldscript-vercel-retention.lock')) {
  const mine = `${path}.${suffix()}`;
  try {
    writeFileSync(mine, String(process.pid), { flag: 'wx' });
  } catch {
    throw reason('lock-unavailable');
  }
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (tryLink(mine, path)) return releaser(path);
      settle(path);
    }
    throw reason('retention-already-running');
  } finally {
    rmSync(mine, { force: true });
  }
}
